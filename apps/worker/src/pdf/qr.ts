// QR code generation for PDF embedding (docs/v1 §18.3, §18.4). Returns a
// `data:image/png;base64,...` URL the HTML template drops into an <img src>.

import QRCode from 'qrcode';

export const qrDataUrl = async (text: string): Promise<string> =>
  QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 6,
  });
