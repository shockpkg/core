import {Readable} from 'stream';

import request from 'request';

import {Package} from './package';

export type PackageLike = Package | string;

export type OnData = (data: string | Buffer) => any;

export type OnResponse = (response: request.Response) => any;

export interface IPackageInstallBefore {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Install method.
	 */
	method: string;
}
export interface IPackageInstallAfter {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Install method.
	 */
	method: string;
}
export interface IPackageInstallCurrent {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Install method.
	 */
	method: string;
}

export interface IPackageDownloadBefore {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageDownloadAfter {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageDownloadProgress {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Progress total.
	 */
	total: number;

	/**
	 * Progress amount.
	 */
	amount: number;
}

export interface IPackageStreamBefore {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageStreamAfter {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageStreamProgress {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Progress total.
	 */
	total: number;

	/**
	 * Progress amount.
	 */
	amount: number;
}

export interface IPackageExtractBefore {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageExtractAfter {

	/**
	 * Package instance.
	 */
	package: Package;
}
export interface IPackageExtractProgress {

	/**
	 * Package instance.
	 */
	package: Package;

	/**
	 * Progress total.
	 */
	total: number;

	/**
	 * Progress amount.
	 */
	amount: number;
}

export interface IPackageCleanupBefore {

	/**
	 * Package name.
	 */
	package: string;
}
export interface IPackageCleanupAfter {

	/**
	 * Package name.
	 */
	package: string;

	/**
	 * Package removed.
	 */
	removed: boolean;
}

export interface IPackageInstalled {

	/**
	 * Package installed.
	 */
	package: Package;

	/**
	 * List of packages processed.
	 */
	installed: Package[];
}

export interface IPackageRemovedObsolete {

	/**
	 * Package removed.
	 */
	package: string;

	/**
	 * Removed or already removed.
	 */
	removed: boolean;
}

export interface IPackageRemovedOutdated {

	/**
	 * Package removed.
	 */
	package: Package;

	/**
	 * Removed or already removed.
	 */
	removed: boolean;
}

export interface IPackageUpdated {

	/**
	 * Package name.
	 */
	name: string;

	/**
	 * File name.
	 */
	file: string;

	/**
	 * File size.
	 */
	size: number;

	/**
	 * SHA256 hash of the file contents.
	 */
	sha256: string;
}

export type IRequestOptions =
	(request.UrlOptions & request.CoreOptions) |
	(request.UriOptions & request.CoreOptions);

/* eslint-disable @typescript-eslint/indent */
export type IRequestInstance = request.RequestAPI<
	request.Request,
	request.CoreOptions,
	request.RequiredUriUrl
>;
/* eslint-enable @typescript-eslint/indent */

export type IRequestDefaults = request.CoreOptions;

export type IRequestCallback = request.RequestCallback;

export type IRequestStream = request.Request;

export type IRequestResponse = request.Response;

export interface IRequestPromiseValue {

	/**
	 * Request stream.
	 */
	stream: IRequestStream;

	/**
	 * Request response.
	 */
	response: IRequestResponse;

	/**
	 * Request body.
	 */
	body: any;
}

export interface IZipItterEntry {

	/**
	 * Path.
	 */
	path: string;

	/**
	 * Is directory.
	 */
	dir: boolean;

	/**
	 * CRC32.
	 */
	crc32: number;

	/**
	 * Size compressed.
	 */
	sizeC: number;

	/**
	 * Size decompressed.
	 */
	sizeD: number;

	/**
	 * Stream contents (does not wait for it to be closed).
	 */
	stream(): Promise<Readable>;
}

export type ZipItter = (info: IZipItterEntry) => Promise<boolean>;

export type ZipStreamer = (start: number, end: number) => Readable;

export interface IPackageReceipt {

	/**
	 * Package name.
	 */
	name: string;

	/**
	 * File name.
	 */
	file: string;

	/**
	 * File size.
	 */
	size: number;

	/**
	 * SHA256 hash of the file contents.
	 */
	sha256: string;

	/**
	 * Source, URL for root or file path for children.
	 */
	source: string;
}

export interface IPackagesListPackage {

	/**
	 * Package name.
	 */
	name: string;

	/**
	 * File name.
	 */
	file: string;

	/**
	 * File size.
	 */
	size: number;

	/**
	 * SHA256 hash of the file contents.
	 */
	sha256: string;

	/**
	 * Source, URL for root or file path for children.
	 */
	source: string;

	/**
	 * Optional child package list.
	 */
	packages?: IPackagesListPackage[];
}

export interface IPackagesList {

	/**
	 * Format version.
	 */
	format: string;

	/**
	 * Package list.
	 */
	packages: IPackagesListPackage[];
}

export type HashEncoding = 'hex' | 'base64';

export interface IHash {

	/**
	 * Hash algorithm.
	 */
	algorithm: string;

	/**
	 * Hash encoding.
	 */
	encoding: HashEncoding;

	/**
	 * Digest value.
	 */
	digest: string;
}
