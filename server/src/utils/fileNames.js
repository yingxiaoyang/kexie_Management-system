import path from 'node:path';

const MOJIBAKE_MARKERS = /[\u0080-\u009f\ufffd]|(?:Ã.|Â.|â.|ð.|æ.|å.|ç.|ä.|é.|ï.)/u;
const CJK_TEXT = /[\u3400-\u9fff\uf900-\ufaff]/u;
const SAFE_INLINE_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png']
]);

function latin1Bytes(value) {
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint > 0xff) return null;
    bytes.push(codePoint);
  }
  return Buffer.from(bytes);
}

export function inspectOriginalFileName(value) {
  const originalName = String(value || '').normalize('NFC');
  if (!MOJIBAKE_MARKERS.test(originalName)) {
    return { originalName, displayName: originalName, recovered: false, warning: null };
  }

  const bytes = latin1Bytes(originalName);
  if (bytes) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC');
      const roundTrip = Buffer.from(decoded, 'utf8');
      if (decoded && decoded !== originalName && roundTrip.equals(bytes) && CJK_TEXT.test(decoded)) {
        return {
          originalName,
          displayName: decoded,
          recovered: true,
          warning: '该旧记录的文件名已从可确认的编码错误中自动修复显示'
        };
      }
    } catch {
      // Preserve uncertain legacy names rather than guessing.
    }
  }

  return {
    originalName,
    displayName: originalName,
    recovered: false,
    warning: '该旧记录的文件名疑似存在历史编码问题，系统无法可靠判断，已保留原名'
  };
}

export function normalizeUploadedFileName(value) {
  return inspectOriginalFileName(value).displayName;
}

export function filePreviewInfo(fileName, mimeType) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const expectedMimeType = SAFE_INLINE_TYPES.get(extension);
  const normalizedMimeType = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (expectedMimeType && normalizedMimeType === expectedMimeType) {
    return {
      previewable: true,
      previewType: extension === '.pdf' ? 'pdf' : 'image',
      previewMimeType: expectedMimeType,
      previewMessage: null
    };
  }
  return {
    previewable: false,
    previewType: null,
    previewMimeType: null,
    previewMessage: '该文件类型不支持安全网页预览，请下载原文件后使用本机软件查看'
  };
}

export function matchesPreviewSignature(bytes, mimeType) {
  const buffer = Buffer.from(bytes || []);
  if (mimeType === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return false;
}

function cleanHeaderFileName(value, fallback = 'download') {
  const inspected = inspectOriginalFileName(value);
  const baseName = path.basename(inspected.displayName).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return baseName || fallback;
}

export function contentDisposition(disposition, fileName) {
  const safeName = cleanHeaderFileName(fileName);
  const asciiFallback = safeName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_') || 'download';
  const encodedName = encodeURIComponent(safeName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`;
}

export function setFileResponseHeaders(res, { disposition = 'attachment', fileName, contentType = 'application/octet-stream' }) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', contentDisposition(disposition, fileName));
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
