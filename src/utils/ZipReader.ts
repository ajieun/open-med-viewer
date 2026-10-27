/**
 * ZipReader - 零依赖轻量级 ZIP 归档读取器
 *
 * 基于浏览器原生 DecompressionStream 实现 (支持 Stored / Deflate 两种压缩方式)，
 * 支持标准 ZIP 与 ZIP64(>4GB 或 >65535 条目)，用于本地导入打包的多帧影像序列。
 */

export interface ZipEntry {
  /** 归档内完整路径名 */
  name: string;
  /** 解压后大小 (bytes) */
  size: number;
  /** 压缩后大小 (bytes) */
  compressedSize: number;
  /** 压缩方式: 0 = Stored, 8 = Deflate */
  method: number;
  crc32: number;
  /** 本地文件头偏移 */
  offset: number;
  isDirectory: boolean;
  encrypted: boolean;
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOCATOR64 = 0x07064b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export class ZipReader {
  private bytes: Uint8Array;
  private view: DataView;
  private entries: ZipEntry[] = [];

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.readCentralDirectory();
  }

  /**
   * 从 File / Blob / ArrayBuffer / 远程 URL 打开 ZIP 归档
   */
  static async open(
    source: File | Blob | ArrayBuffer | Uint8Array | string,
    headers?: Record<string, string>
  ): Promise<ZipReader> {
    let buffer: ArrayBuffer;

    if (typeof source === 'string') {
      const res = await fetch(source, { headers });
      if (!res.ok) throw new Error(`下载 ZIP 失败: HTTP ${res.status}`);
      buffer = await res.arrayBuffer();
    } else if (source instanceof ArrayBuffer) {
      buffer = source;
    } else if (source instanceof Uint8Array) {
      buffer = new Uint8Array(source).buffer as ArrayBuffer;
    } else {
      buffer = await source.arrayBuffer();
    }

    return new ZipReader(new Uint8Array(buffer));
  }

  static isZip(buffer: Uint8Array | ArrayBuffer): boolean {
    const u8 = buffer instanceof ArrayBuffer ? new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)) : buffer;
    return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07);
  }

  getEntries(): ZipEntry[] {
    return this.entries.slice();
  }

  /**
   * 解压并读取指定条目的原始字节
   */
  async extract(entry: ZipEntry): Promise<Uint8Array> {
    if (entry.encrypted) {
      throw new Error(`ZIP 内的 [${entry.name}] 已加密，暂不支持解密`);
    }

    const localOffset = entry.offset;
    if (this.view.getUint32(localOffset, true) !== SIG_LOCAL) {
      throw new Error(`ZIP 条目 [${entry.name}] 的本地文件头损坏`);
    }

    const nameLen = this.view.getUint16(localOffset + 26, true);
    const extraLen = this.view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + nameLen + extraLen;
    const dataEnd = Math.min(dataStart + entry.compressedSize, this.bytes.length);
    const raw = this.bytes.subarray(dataStart, dataEnd);

    if (entry.method === METHOD_STORED) {
      return raw.slice();
    }
    if (entry.method === METHOD_DEFLATE) {
      return await inflateRaw(raw);
    }
    throw new Error(`不支持的 ZIP 压缩方式 (method=${entry.method}): ${entry.name}`);
  }

  /**
   * 读取条目并按 UTF-8 解码为文本
   */
  async extractText(entry: ZipEntry): Promise<string> {
    const data = await this.extract(entry);
    return new TextDecoder('utf-8').decode(data);
  }

  // ==================== 中央目录解析 ====================

  private readCentralDirectory(): void {
    const eocd = this.findEOCD();
    if (eocd < 0) {
      throw new Error('无效的 ZIP 文件: 未找到 End Of Central Directory 记录');
    }

    let totalEntries = this.view.getUint16(eocd + 10, true);
    let cdOffset = this.view.getUint32(eocd + 16, true);

    // ZIP64 扩展
    if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
      const zip64 = this.readZip64(eocd);
      if (zip64) {
        totalEntries = zip64.totalEntries;
        cdOffset = zip64.cdOffset;
      }
    }

    const entries: ZipEntry[] = [];
    let p = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (p + 46 > this.bytes.length || this.view.getUint32(p, true) !== SIG_CENTRAL) break;

      const flags = this.view.getUint16(p + 8, true);
      const method = this.view.getUint16(p + 10, true);
      const crc32 = this.view.getUint32(p + 16, true);
      let compressedSize = this.view.getUint32(p + 20, true);
      let size = this.view.getUint32(p + 24, true);
      const nameLen = this.view.getUint16(p + 28, true);
      const extraLen = this.view.getUint16(p + 30, true);
      const commentLen = this.view.getUint16(p + 32, true);
      let offset = this.view.getUint32(p + 42, true);

      const nameBytes = this.bytes.subarray(p + 46, p + 46 + nameLen);
      const name = decodeName(nameBytes, (flags & 0x800) !== 0);

      // ZIP64 扩展字段 (0x0001) 覆盖 32 位溢出的字段
      if (size === 0xffffffff || compressedSize === 0xffffffff || offset === 0xffffffff) {
        const extra = this.bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
        const z64 = this.parseZip64Extra(extra, { size, compressedSize, offset });
        size = z64.size;
        compressedSize = z64.compressedSize;
        offset = z64.offset;
      }

      const isDirectory = name.endsWith('/') || (size === 0 && compressedSize === 0 && method === METHOD_STORED);

      entries.push({
        name,
        size,
        compressedSize,
        method,
        crc32,
        offset,
        isDirectory,
        encrypted: (flags & 0x1) !== 0
      });

      p += 46 + nameLen + extraLen + commentLen;
    }

    this.entries = entries;
  }

  private findEOCD(): number {
    const min = Math.max(0, this.bytes.length - 22 - 0xffff);
    for (let i = this.bytes.length - 22; i >= min; i--) {
      if (this.view.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  private readZip64(eocd: number): { totalEntries: number; cdOffset: number } | null {
    const loc = eocd - 20;
    if (loc < 0 || this.view.getUint32(loc, true) !== SIG_LOCATOR64) return null;

    const z64Offset = Number(this.view.getBigUint64(loc + 8, true));
    if (z64Offset < 0 || z64Offset + 56 > this.bytes.length) return null;
    if (this.view.getUint32(z64Offset, true) !== SIG_EOCD64) return null;

    const totalEntries = Number(this.view.getBigUint64(z64Offset + 32, true));
    const cdOffset = Number(this.view.getBigUint64(z64Offset + 48, true));
    return { totalEntries, cdOffset };
  }

  private parseZip64Extra(
    extra: Uint8Array,
    current: { size: number; compressedSize: number; offset: number }
  ): { size: number; compressedSize: number; offset: number } {
    let size = current.size;
    let compressedSize = current.compressedSize;
    let offset = current.offset;

    let p = 0;
    while (p + 4 <= extra.length) {
      const id = extra[p] | (extra[p + 1] << 8);
      const len = extra[p + 2] | (extra[p + 3] << 8);
      const body = p + 4;
      if (id === 0x0001 && body + len <= extra.length) {
        const dv = new DataView(extra.buffer, extra.byteOffset + body, len);
        let q = 0;
        if (size === 0xffffffff && q + 8 <= len) {
          size = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === 0xffffffff && q + 8 <= len) {
          compressedSize = Number(dv.getBigUint64(q, true));
          q += 8;
        }
        if (offset === 0xffffffff && q + 8 <= len) {
          offset = Number(dv.getBigUint64(q, true));
        }
        break;
      }
      p = body + len;
    }

    return { size, compressedSize, offset };
  }
}

function decodeName(bytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) return new TextDecoder('utf-8').decode(bytes);
  // 非 UTF-8 标记位时按 UTF-8 宽松解码，失败不会中断流程
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * 使用原生 DecompressionStream 解压 raw deflate 数据
 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as any).DecompressionStream;
  if (typeof Ctor !== 'function') {
    throw new Error('当前运行环境不支持 ZIP Deflate 解压 (缺少 DecompressionStream)，请改用 Store(不压缩) 模式打包或升级浏览器');
  }

  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new Ctor('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}
