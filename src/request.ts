/* eslint-disable max-classes-per-file */
import {Readable} from 'stream';

import fetch from 'node-fetch';
import AbortController from 'abort-controller';

import {
	IRequestCallback,
	IRequestDefaults,
	IRequestInstance,
	IRequestOptions,
	IRequestPromiseValue,
	IRequestStream,
	IRequestResponse
} from './types';
import {NAME, VERSION} from './meta';

const userAgent = `${NAME}/${VERSION}`;

/**
 * RequestStream, similar to the deprecated request module stream.
 *
 * @param options Request options.
 */
class RequestStream extends Readable {
	/**
	 * Request options.
	 */
	private _options_: Readonly<IRequestOptions> | null;

	/**
	 * Abort controller.
	 */
	private _abortController_: AbortController | null = null;

	constructor(options: Readonly<IRequestOptions>) {
		super();

		this._options_ = options;
	}

	/**
	 * Abort request.
	 */
	public abort() {
		this.destroy();
	}

	/**
	 * Read implementation.
	 *
	 * @param _size Size to be read.
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _read(_size: number) {
		// Get options if set, only starts reading once.
		const options = this._options_;
		if (!options) {
			return;
		}
		this._options_ = null;

		fetch(options.url, {
			signal: (this._abortController_ = new AbortController()).signal,
			method: options.method || 'GET',
			headers: {
				'User-Agent': userAgent,
				...(options.headers || {})
			},
			compress: !!options.gzip
		}).then(
			res => {
				const {status, headers, body} = res;
				const headersRaw = headers.raw();
				const headersObject: {[key: string]: string} = {};
				for (const p of Object.keys(headersRaw)) {
					headersObject[p] = headersRaw[p].join(', ');
				}
				const response = {
					statusCode: status,
					headers: headersObject
				};
				body.on('error', err => {
					this.emit('error', err);
				});
				body.on('data', data => {
					this.push(data);
				});
				body.on('end', () => {
					this.push(null);
				});
				this.on('end', () => {
					this.emit('complete', response);
				});
				this.emit('response', response);
			},
			err => {
				this.emit('error', err);
			}
		);
	}

	/**
	 * Destroy implementation.
	 *
	 * @param error Error object.
	 * @param callback Callback function.
	 */
	// eslint-disable-next-line @typescript-eslint/naming-convention
	public _destroy(
		error: Error | null,
		callback: (error?: Error | null) => void
	) {
		const abortController = this._abortController_;
		this._abortController_ = null;
		if (abortController) {
			abortController.abort();
		}

		super._destroy(error, callback);
	}
}

/**
 * Request wrapper around the request module.
 *
 * @param defaults Default options.
 */
export class Request extends Object {
	/**
	 * Request instance.
	 */
	protected readonly _request: IRequestInstance;

	constructor(defaults: Readonly<IRequestDefaults> = {}) {
		super();

		this._request = this._createRequestInstance(defaults);
	}

	/**
	 * Make request with an optional callback.
	 *
	 * @param options Request options.
	 * @param cb An optional callback function.
	 * @returns Stream object.
	 */
	public stream(
		options: Readonly<IRequestOptions>,
		cb?: IRequestCallback
	): IRequestStream {
		const req = this._request;
		return cb ? req(options, cb) : req(options);
	}

	/**
	 * Make request with promise.
	 *
	 * @param options Request options.
	 * @returns Stream response and body.
	 */
	public async promise(options: Readonly<IRequestOptions>) {
		return new Promise<IRequestPromiseValue>((resolve, reject) => {
			const stream = this.stream(options, (error, response, body) => {
				if (error) {
					reject(error);
					return;
				}
				resolve({
					stream,
					response,
					body
				});
			});
		});
	}

	/**
	 * Create the request instance.
	 *
	 * @param defaults Option defaults.
	 * @returns Request instance.
	 */
	protected _createRequestInstance(
		defaults: Readonly<IRequestDefaults> = {}
	) {
		const request = this._createRequest(defaults) as any as (
			IRequestInstance | null
		);
		return request || ((
			options: Readonly<IRequestOptions>,
			cb?: IRequestCallback
		) => {
			const opts = {...defaults, ...options};
			const request = new RequestStream(opts);
			if (cb) {
				let response: IRequestResponse = {
					statusCode: 0,
					headers: {}
				};
				const datas: Buffer[] = [];
				request.on('response', resp => {
					response = resp;
				});
				request.on('data', data => {
					datas.push(data);
				});
				request.on('error', err => {
					request.abort();
					cb(err, response, Buffer.concat(datas));
				});
				request.on('complete', resp => {
					const data = Buffer.concat(datas);
					const {encoding} = opts;
					cb(
						null,
						resp,
						encoding === null ?
							data :
							data.toString(encoding as any)
					);
				});
			}
			return request;
		});
	}

	/**
	 * Make a request object.
	 *
	 * @param _defaults Request defaults.
	 * @returns Request instance.
	 * @deprecated Included for backwards compatability.
	 */
	protected _createRequest(
		_defaults: Readonly<IRequestDefaults> = {}
	): Function | null {
		return null;
	}
}
