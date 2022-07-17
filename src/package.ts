import {IPackagesListPackage} from './types';

/**
 * Package object.
 */
export class Package extends Object {
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
		super();

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
