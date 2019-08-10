import {IPackagesListPackage} from './types';

/**
 * Package constructor.
 *
 * @param info Package info.
 * @param parent Package parent.
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
	 * Source path, URL for root, file path for child packages.
	 */
	public readonly source: string;

	/**
	 * Child packages.
	 */
	public readonly packages: Package[];

	/**
	 * The parent package this package is found in.
	 */
	public readonly parent: Package | null;

	constructor(info: IPackagesListPackage, parent: Package | null = null) {
		super();

		this.name = info.name;
		this.file = info.file;
		this.size = info.size;
		this.sha256 = info.sha256;
		this.source = info.source;
		this.parent = parent;
		this.packages = this._createPackages(info.packages);
	}

	/**
	 * Create child packages list.
	 *
	 * @param infos Package infos.
	 * @returns Package instance.
	 */
	protected _createPackages(infos: IPackagesListPackage[] = []) {
		return infos.map(info => this._createPackage(info));
	}

	/**
	 * Create a child package.
	 *
	 * @param info Package info.
	 * @returns Package instance.
	 */
	protected _createPackage(info: IPackagesListPackage) {
		const Constructor = this.constructor as typeof Package;
		return new Constructor(info, this);
	}
}
