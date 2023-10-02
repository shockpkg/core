import {ReadableStream} from 'node:stream/web';

export interface IFetchRequestHeaders {
	[header: string]: string;
}

export interface IFetchRequestInit {
	/**
	 * Request headers.
	 */
	headers?: {[header: string]: string};
}

export interface IFetchResponseHeaders {
	/**
	 * Get header case-insensitive.
	 */
	get(header: string): string | null;
}

export interface IFetchResponse {
	/**
	 * Response status code.
	 */
	status: number;

	/**
	 * Response headers.
	 */
	headers: IFetchResponseHeaders;

	/**
	 * Response body as a readable stream.
	 */
	body: ReadableStream | NodeJS.ReadableStream;

	/**
	 * Response body as text.
	 */
	text: () => Promise<string>;
}

export type IFetch = (
	url: string,
	init?: IFetchRequestInit
) => Promise<IFetchResponse>;
