import {Package} from './package';

export type PackageLike = Package | string;

export interface IPackageInstallBefore {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallAfter {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageInstallCurrent {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadBefore {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadAfter {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageDownloadProgress {
	//
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
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageExtractAfter {
	//
	/**
	 * Package instance.
	 */
	package: Package;
}

export interface IPackageExtractProgress {
	//
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
	//
	/**
	 * Package name.
	 */
	package: string;
}

export interface IPackageCleanupAfter {
	//
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
	//
	/**
	 * Package installed.
	 */
	package: Package;

	/**
	 * List of packages processed to complete the install.
	 */
	install: Package[];
}

export interface IPackageRemovedObsolete {
	//
	/**
	 * Package removed.
	 */
	package: string;

	/**
	 * Removed or already removed.
	 */
	removed: boolean;
}

export interface IPackageUpdated {
	//
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

export interface IPackageReceipt {
	//
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
	//
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
	 * SHA1 hash of the file contents.
	 */
	sha1: string;

	/**
	 * MD5 hash of the file contents.
	 */
	md5: string;

	/**
	 * Source, URL for root or file path for children.
	 */
	source: string;

	/**
	 * Optional child package list.
	 */
	packages?: IPackagesListPackage[];

	/**
	 * Zipped info if a child package or null if a root package.
	 */
	zipped?: string;
}

export interface IPackagesList {
	//
	/**
	 * Format version.
	 */
	format: string;

	/**
	 * Package list.
	 */
	packages: IPackagesListPackage[];
}
