declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(params: object): { promise: Promise<unknown> };
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const workerSrc: string;
  export default workerSrc;
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(params: object): { promise: Promise<unknown> };
}

declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs?url' {
  const workerSrc: string;
  export default workerSrc;
}
