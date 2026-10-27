export type ColormapType = 'grayscale' | 'hot-iron' | 'rainbow' | 'pet' | 'bone';

export class ColorMaps {
  private static lutCache: Map<ColormapType, Uint8Array> = new Map();

  /**
   * 获取 256 阶 RGBA 色彩查找表 (1024 字节)
   */
  static getLut(type: ColormapType = 'grayscale'): Uint8Array {
    if (this.lutCache.has(type)) {
      return this.lutCache.get(type)!;
    }

    const lut = new Uint8Array(256 * 4);

    for (let i = 0; i < 256; i++) {
      const idx = i * 4;
      const t = i / 255;

      switch (type) {
        case 'hot-iron': {
          // 仿射热铁色 (用于核医学、SPECT、热成像)
          if (t < 0.33) {
            lut[idx] = Math.round((t / 0.33) * 255); // R
            lut[idx + 1] = 0; // G
            lut[idx + 2] = 0; // B
          } else if (t < 0.66) {
            lut[idx] = 255;
            lut[idx + 1] = Math.round(((t - 0.33) / 0.33) * 255);
            lut[idx + 2] = 0;
          } else {
            lut[idx] = 255;
            lut[idx + 1] = 255;
            lut[idx + 2] = Math.round(((t - 0.66) / 0.34) * 255);
          }
          break;
        }

        case 'rainbow': {
          // 彩虹色彩
          const hue = (1 - t) * 240; // 240 (蓝) 到 0 (红)
          const [r, g, b] = this.hslToRgb(hue / 360, 1.0, 0.5);
          lut[idx] = r;
          lut[idx + 1] = g;
          lut[idx + 2] = b;
          break;
        }

        case 'pet': {
          // PET 常用高对比反相色
          const v = Math.round((1 - t) * 255);
          lut[idx] = v;
          lut[idx + 1] = v;
          lut[idx + 2] = v;
          break;
        }

        case 'bone': {
          // 骨增强青灰色调
          lut[idx] = Math.round(Math.min(255, t * 255 * 1.05));
          lut[idx + 1] = Math.round(Math.min(255, t * 255 * 1.0));
          lut[idx + 2] = Math.round(Math.min(255, t * 255 * 1.15));
          break;
        }

        case 'grayscale':
        default: {
          lut[idx] = i;
          lut[idx + 1] = i;
          lut[idx + 2] = i;
          break;
        }
      }

      lut[idx + 3] = 255; // Alpha
    }

    this.lutCache.set(type, lut);
    return lut;
  }

  private static hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number, g: number, b: number;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}
