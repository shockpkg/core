import fse from 'fs-extra';

import {property} from './decorators';
import {Package} from './package';
import {
	IPackagesList,
	IPackagesListPackage,
	IPackageUpdated
} from './types';

/**
 * Packages constructor.
 *
 * @param path The path to the packages file.
 */
export class Packages extends Object {
	/**
	 * Packages data.
	 */
	@property(false)
	protected _packagesList: IPackagesList | null = null;

	/**
	 * Packages array.
	 */
	@property(false)
	protected _packages = new Set<Package>();

	/**
	 * Packages mapped by name.
	 */
	@property(false)
	protected _packagesByName = new Map<string, Package>();

	/**
	 * Packages mapped by sha256.
	 */
	@property(false)
	protected _packagesBySha256 = new Map<string, Package>();

	/**
	 * Packages mapped by unique.
	 */
	@property(false)
	protected _packagesByUnique = new Map<string, Package>();

	/**
	 * The path to the packages file.
	 */
	@property(false)
	protected readonly _path: string;

	/**
	 * Format version.
	 */
	public static readonly FORMAT: string = '1.0';

	constructor(path: string) {
		super();

		this._path = path;
	}

	/**
	 * Get path of the packages file.
	 *
	 * @returns The path.
	 */
	public get path() {
		return this._path;
	}

	/**
	 * Get if packages loaded.
	 *
	 * @returns Is loaded.
	 */
	public get loaded() {
		return !!this._packagesList;
	}

	/**
	 * Update packages.
	 *
	 * @param data Encoded data.
	 * @returns Update report.
	 */
	public update(data: string) {
		// Map out current list if any.
		const map = new Map<string, IPackageUpdated>();
		for (const pkg of this.itter()) {
			const {name, file, size, sha256} = pkg;
			map.set(name, {
				name,
				file,
				size,
				sha256
			});
		}

		// Actually set the data.
		this._setPackagesList(this._parseData(data));

		// List out the changes of significance.
		const updated: IPackageUpdated[] = [];
		const added: IPackageUpdated[] = [];
		const removed: IPackageUpdated[] = [];
		for (const pkg of this.itter()) {
			const {name, file, size, sha256} = pkg;
			const obj: IPackageUpdated = {
				name,
				file,
				size,
				sha256
			};

			const before = map.get(name) || null;
			map.delete(name);

			if (!before) {
				added.push(obj);
				continue;
			}

			if (
				before.sha256 !== sha256 ||
				before.size !== size ||
				before.file !== file
			) {
				updated.push(obj);
			}
		}
		for (const [, obj] of map) {
			removed.push(obj);
		}

		return {
			updated,
			added,
			removed
		};
	}

	/**
	 * Assert loaded.
	 */
	public assertLoaded() {
		if (!this.loaded) {
			throw new Error('Packages list not loaded');
		}
	}

	/**
	 * Check if the file path exists.
	 *
	 * @returns Does exist.
	 */
	public async exists() {
		return fse.pathExists(this.path);
	}

	/**
	 * Read the file path.
	 */
	public async read() {
		const data = await fse.readJson(this.path);
		this._setPackagesList(this._castData(data));
	}

	/**
	 * Write packages to the file path.
	 */
	public async write() {
		if (!this._packagesList) {
			throw new Error('Cannot write unloaded list');
		}
		await fse.writeJson(this.path, this._packagesList, {
			spaces: '\t'
		});
	}

	/**
	 * Read the file path if the file exists.
	 *
	 * @returns Did exist.
	 */
	public async readIfExists() {
		if (await this.exists()) {
			await this.read();
			return true;
		}
		return false;
	}

	/**
	 * Itterate over the packages.
	 */
	public * itter() {
		const packages = this._packages;
		for (const entry of packages) {
			// If the set changes, break loop.
			if (packages !== this._packages) {
				break;
			}
			yield entry;
		}
	}

	/**
	 * Check if package is in this collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	public has(pkg: Package) {
		return this._packages.has(pkg);
	}

	/**
	 * Assert the package is in this collection.
	 *
	 * @param pkg Package instance.
	 */
	public assertHas(pkg: Package) {
		if (!this.has(pkg)) {
			throw new Error('Package not in collection');
		}
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	public byName(name: string) {
		return this._packagesByName.get(name) || null;
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	public bySha256(sha256: string) {
		return this._packagesBySha256.get(sha256) || null;
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	public byUnique(unique: string) {
		return this._packagesByUnique.get(unique) || null;
	}

	/**
	 * Create a package instance.
	 *
	 * @param info Package info.
	 * @returns Package instance.
	 */
	protected _createPackage(info: Readonly<IPackagesListPackage>) {
		return new Package(info);
	}

	/**
	 * Set the packages list.
	 *
	 * @param packagesList Parsed list.
	 */
	protected _setPackagesList(packagesList: Readonly<IPackagesList>) {
		this._validateFormat(packagesList.format);

		const parsed = this._parsePackages(packagesList.packages);
		const packages = this._listPackages(parsed);

		// Map out the names and hashes.
		const byName = this._packagesMapName(packages);
		const bySha256 = this._packagesMapSha256(packages);
		const byUnique = this._packagesMapUnique(packages);

		// If all parsed successfully, set properties.
		this._packagesList = packagesList;
		this._packages = packages;
		this._packagesByName = byName;
		this._packagesBySha256 = bySha256;
		this._packagesByUnique = byUnique;
	}

	/**
	 * Validate format version string.
	 *
	 * @param format The format version string.
	 */
	protected _validateFormat(format: string) {
		const Constructor = this.constructor as typeof Packages;
		const version = Constructor.FORMAT.split('.').map(Number);
		const parts = format.split('.').map(Number);

		if (parts.length !== 2) {
			throw new Error(`Invalid format version value: ${format}`);
		}

		if (!(parts[0] === version[0])) {
			throw new Error(`Invalid format version major: ${format}`);
		}

		if (!(parts[1] >= version[1])) {
			throw new Error(`Invalid format version minor: ${format}`);
		}
	}

	/**
	 * Parse the packages list.
	 *
	 * @param packages Packages list.
	 * @returns Parsed list.
	 */
	protected _parsePackages(
		packages: Readonly<Readonly<IPackagesListPackage>[]>
	) {
		return packages.map(info => this._createPackage(info));
	}

	/**
	 * List all packages deep.
	 *
	 * @param packages A list of packages.
	 * @returns A set of all packages and their children.
	 */
	protected _listPackages(packages: Readonly<Package[]>) {
		const r = new Set<Package>();
		const itter = [...packages];

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const entry = itter.shift();
			if (!entry) {
				break;
			}
			r.add(entry);
			const chilren = entry.packages;
			if (chilren) {
				itter.unshift(...chilren);
			}
		}
		return r;
	}

	/**
	 * Map out package list by name.
	 * Throws on any duplicates.
	 *
	 * @param packages Packages list.
	 * @returns Map from package name to package.
	 */
	protected _packagesMapName(packages: Readonly<Set<Package>>) {
		const r = new Map<string, Package>();

		for (const entry of packages as Set<Package>) {
			const {name} = entry;
			if (r.has(name)) {
				throw new Error(`Duplicate package name: ${name}`);
			}
			r.set(name, entry);
		}

		return r;
	}

	/**
	 * Map out package list by sha256.
	 * Throws on any duplicates.
	 *
	 * @param packages Packages list.
	 * @returns Map from package sha256 to package.
	 */
	protected _packagesMapSha256(packages: Readonly<Set<Package>>) {
		const r = new Map<string, Package>();

		for (const entry of packages as Set<Package>) {
			const {sha256} = entry;
			if (r.has(sha256)) {
				throw new Error(`Duplicate package sha256: ${sha256}`);
			}
			r.set(sha256, entry);
		}

		return r;
	}

	/**
	 * Map out package list by unique.
	 * Throws on any duplicates.
	 *
	 * @param packages Packages list.
	 * @returns Map from package unique to package.
	 */
	protected _packagesMapUnique(packages: Readonly<Set<Package>>) {
		const r = new Map<string, Package>();

		for (const entry of packages as Set<Package>) {
			for (const unique of [
				entry.name,
				entry.sha256
			]) {
				if (r.has(unique)) {
					throw new Error(`Duplicate package unique: ${unique}`);
				}
				r.set(unique, entry);
			}
		}

		return r;
	}

	/**
	 * Parse and cast the encoded data.
	 *
	 * @param data Encoded data.
	 * @returns Parsed and cast data.
	 */
	protected _parseData(data: string) {
		const parsed = JSON.parse(data);
		return this._castData(parsed);
	}

	/**
	 * Cast the parsed data.
	 *
	 * @param packages Parsed data.
	 * @returns Cast data.
	 */
	protected _castData(packages: Readonly<any>) {
		if (
			!packages ||
			typeof packages !== 'object' ||
			typeof packages.format !== 'string' ||
			!Array.isArray(packages.packages)
		) {
			throw new Error('Failed to validate packages');
		}

		return packages as IPackagesList;
	}
}
