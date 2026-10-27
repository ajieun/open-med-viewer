/**
 * Node.js `url` 模块的浏览器端最小实现
 *
 * 背景: xmlbuilder2 -> @oozcitak/url 在模块顶层 `require("url")`，
 * 浏览器构建中该内置模块会被外部化为空对象，调用 domainToASCII/domainToUnicode 时会抛错。
 * 这里基于浏览器原生 URL 提供等价能力。
 */

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

/** 域名转 ASCII (Punycode) */
export function domainToASCII(domain: string): string {
  if (!domain) return '';
  try {
    return new globalThis.URL(`http://${domain}`).hostname;
  } catch {
    return '';
  }
}

/** 域名转 Unicode (浏览器侧保留原样) */
export function domainToUnicode(domain: string): string {
  return domain || '';
}

/** 兼容 url.parse 的简易实现 */
export function parse(urlStr: string): Record<string, any> | null {
  try {
    const u = new globalThis.URL(urlStr, 'http://localhost');
    return {
      href: u.href,
      protocol: u.protocol,
      host: u.host,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      query: u.search.replace(/^\?/, ''),
      hash: u.hash
    };
  } catch {
    return null;
  }
}

/** 兼容 url.format 的简易实现 */
export function format(urlObj: Record<string, any>): string {
  if (typeof urlObj === 'string') return urlObj;
  const protocol = (urlObj.protocol || 'http:').replace(/:?$/, ':');
  const host = urlObj.host || urlObj.hostname || 'localhost';
  const port = urlObj.port ? `:${urlObj.port}` : '';
  const pathname = urlObj.pathname || '/';
  const search = urlObj.search || (urlObj.query ? `?${urlObj.query}` : '');
  const hash = urlObj.hash || '';
  return `${protocol}//${host}${port}${pathname}${search}${hash}`;
}

/** 兼容 url.resolve */
export function resolve(from: string, to: string): string {
  try {
    return new globalThis.URL(to, from).toString();
  } catch {
    return to;
  }
}

export default {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  domainToASCII,
  domainToUnicode,
  parse,
  format,
  resolve
};
