import nodeFetch from 'node-fetch';

export interface IFetchRequestInit {
	//
	/**
	 * Request headers.
	 */
	headers?: {[header: string]: string};
}

export interface IFetchResponseHeaders {
	//
	/**
	 * Get header case-insensitive.
	 */
	get(header: string): string | null;
}

export interface IFetchResponse {
	//
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
	body: NodeJS.ReadableStream;

	/**
	 * Response body as text.
	 */
	text: () => Promise<string>;
}

/**
 * A node-fetch similar interface requiring only a sebset of features.
 *
 * @param url The URL.
 * @param init Init options.
 * @returns Response promise.
 */
export async function fetch(url: string, init?: IFetchRequestInit) {
	return nodeFetch(url, init) as Promise<IFetchResponse>;
}

export type IFetch = typeof fetch;
