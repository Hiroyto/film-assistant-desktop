declare module '*.mp4' {
    const src: string;
    export default src;
} 
// pdfjs-dist legacy build (polyfills core-js p/ o V8 do Electron): sem typings
// próprios. Reexporta a superfície pública do entrypoint principal, que usamos.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
    export * from 'pdfjs-dist';
}
