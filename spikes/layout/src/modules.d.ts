// What the build of the layout takes that TypeScript does not know: a stylesheet, which the SDK injects into the page,
// and the text of a module, through the plugin of extension.config.js.
declare module '*.css';

declare module '*?raw' {
	const text: string;
	export default text;
}
