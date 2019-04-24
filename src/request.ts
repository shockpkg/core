import request from 'request';

import {property} from './decorators';
import {
	IRequestCallback,
	IRequestDefaults,
	IRequestInstance,
	IRequestOptions,
	IRequestPromiseValue,
	IRequestStream
} from './types';

/**
 * Request wrapper around the request module.
 *
 * @param defaults Default options.
 */
export class Request extends Object {

	/**
	 * Request instance.
	 */
	@property(false)
	protected readonly _request: IRequestInstance;

	constructor(defaults: IRequestDefaults = {}) {
		super();

		this._request = this._createRequest(defaults);
	}

	/**
	 * Make request with an optional callback.
	 *
	 * @param options Request options.
	 * @param cb An optional callback function.
	 * @return Stream object.
	 */
	public stream(options: IRequestOptions, cb?: IRequestCallback) {
		const req = this._request;
		return (cb ? req(options, cb) : req(options)) as IRequestStream;
	}

	/**
	 * Make request with promise.
	 *
	 * @param options Request options.
	 * @return Stream response and body.
	 */
	public async promise(options: IRequestOptions) {
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
	 * Make a request object.
	 *
	 * @param defaults Request defaults.
	 * @return Request instance.
	 */
	protected _createRequest(defaults: IRequestDefaults = {}) {
		return request.defaults(defaults);
	}
}
