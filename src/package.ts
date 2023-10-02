import {Transform} from 'node:stream';
import {createInflateRaw as zlibCreateInflateRaw} from 'node:zlib';

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

/**
 * Package object.
 */
export class Package {
	/**
	 * Package name.
	 */
	public readonly name: string;

	/**
	 * File name.
	 */
	public readonly file: string;

	/**
	 * File size.
	 */
	public readonly size: number;

	/**
	 * SHA256 hash of file.
	 */
	public readonly sha256: string;

	/**
	 * SHA1 hash of file.
	 */
	public readonly sha1: string;

	/**
	 * MD5 hash of file.
	 */
	public readonly md5: string;

	/**
	 * Source path, URL for root, file path for child packages.
	 */
	public readonly source: string;

	/**
	 * Zipped info if a child package or null if a root package.
	 */
	public readonly zipped: string | null;

	/**
	 * Child packages.
	 */
	public readonly packages: Package[];

	/**
	 * The parent package this package is found in.
	 */
	public readonly parent: Package | null;

	/**
	 * Package constructor.
	 *
	 * @param info Package info.
	 * @param parent Package parent.
	 */
	constructor(
		info: Readonly<IPackagesListPackage>,
		parent: Package | null = null
	) {
		const {zipped} = info;
		if (parent && !zipped) {
			throw new Error(`Missing zipped info: ${info.name}`);
		} else if (!parent && zipped) {
			throw new Error(`Unexpected zipped info: ${info.name}`);
		}

		this.name = info.name;
		this.file = info.file;
		this.size = info.size;
		this.sha256 = info.sha256;
		this.sha1 = info.sha1;
		this.md5 = info.md5;
		this.source = info.source;
		this.zipped = zipped || null;
		this.parent = parent;
		this.packages = this._createPackages(info.packages);
	}

	/**
	 * Get zipped compression method.
	 *
	 * @returns Compression method.
	 */
	public getZippedCompression(): number {
		const {zipped} = this;
		if (!zipped) {
			throw new Error('Not a child package');
		}
		return +zipped.split('-')[0];
	}

	/**
	 * Get zipped data slice.
	 *
	 * @returns Data start and size.
	 */
	public getZippedSlice(): [number, number] {
		const {zipped} = this;
		if (!zipped) {
			throw new Error('Not a child package');
		}
		const parts = zipped.split('-');
		return [+parts[1], +parts[2]];
	}

	/**
	 * Get zipped data decompressor.
	 *
	 * @returns Transform stream or null if entry not compressed.
	 */
	public getZippedDecompressor(): Transform | null {
		const method = this.getZippedCompression();
		switch (method) {
			case 0: {
				return null;
			}
			case 8: {
				return zlibCreateInflateRaw();
			}
			default: {
				// Do nothing.
			}
		}
		throw new Error(`Unsupported zipped compression: ${method}`);
	}

	/**
	 * Create child packages list.
	 *
	 * @param infos Package infos.
	 * @returns Package instance.
	 */
	protected _createPackages(
		infos: Readonly<Readonly<IPackagesListPackage>[]> = []
	) {
		return infos.map(info => this._createPackage(info));
	}

	/**
	 * Create a child package.
	 *
	 * @param info Package info.
	 * @returns Package instance.
	 */
	protected _createPackage(info: Readonly<IPackagesListPackage>) {
		const Constructor = this.constructor as typeof Package;
		return new Constructor(info, this);
	}
}
