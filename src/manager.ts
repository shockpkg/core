import {join as pathJoin} from 'path';

import fse from 'fs-extra';

import {
	MAIN_DIR,
	META_DIR,
	PACKAGE_FILE,
	PACKAGES_FILE,
	PACKAGES_URL,
	PACKAGES_URL_ENV,
	PATH_ENV,
	TEMP_DIR
} from './constants';
import {property} from './decorators';
import {Dispatcher} from './dispatcher';
import {Lock} from './lock';
import {Package} from './package';
import {Packages} from './packages';
import {Request} from './request';
import {
	IPackageCleanupAfter,
	IPackageCleanupBefore,
	IPackageDownloadAfter,
	IPackageDownloadBefore,
	IPackageDownloadProgress,
	IPackageExtractAfter,
	IPackageExtractBefore,
	IPackageExtractProgress,
	IPackageInstallAfter,
	IPackageInstallBefore,
	IPackageInstallCurrent,
	IPackageInstalled,
	IPackageReceipt,
	IPackageRemovedObsolete,
	IPackageStreamAfter,
	IPackageStreamBefore,
	IPackageStreamProgress,
	PackageLike
} from './types';
import {
	arrayFilterAsync,
	arrayMapAsync,
	dependSort,
	fileHashVerify,
	fileSizeVerify,
	lstatExists,
	promiseCatch,
	readDir,
	streamRequest,
	streamRequestDownload,
	zipEntryExtract
} from './util';
import {Zip} from './zip';

/**
 * Manager constructor.
 *
 * @param path The path, defaults to environment variable or relative.
 */
export class Manager extends Object {
	/**
	 * Package install before events.
	 */
	public readonly eventPackageInstallBefore = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallBefore>(this)
	);

	/**
	 * Package install after events.
	 */
	public readonly eventPackageInstallAfter = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallAfter>(this)
	);

	/**
	 * Package install current events.
	 */
	public readonly eventPackageInstallCurrent = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageInstallCurrent>(this)
	);

	/**
	 * Package download before events.
	 */
	public readonly eventPackageDownloadBefore = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadBefore>(this)
	);

	/**
	 * Package download after events.
	 */
	public readonly eventPackageDownloadAfter = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadAfter>(this)
	);

	/**
	 * Package download progress events.
	 */
	public readonly eventPackageDownloadProgress = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageDownloadProgress>(this)
	);

	/**
	 * Package stream before events.
	 */
	public readonly eventPackageStreamBefore = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageStreamBefore>(this)
	);

	/**
	 * Package stream after events.
	 */
	public readonly eventPackageStreamAfter = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageStreamAfter>(this)
	);

	/**
	 * Package stream progress events.
	 */
	public readonly eventPackageStreamProgress = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageStreamProgress>(this)
	);

	/**
	 * Package extract before events.
	 */
	public readonly eventPackageExtractBefore = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractBefore>(this)
	);

	/**
	 * Package extract after events.
	 */
	public readonly eventPackageExtractAfter = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractAfter>(this)
	);

	/**
	 * Package extract progress events.
	 */
	public readonly eventPackageExtractProgress = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageExtractProgress>(this)
	);

	/**
	 * Package cleanup before events.
	 */
	public readonly eventPackageCleanupBefore = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageCleanupBefore>(this)
	);

	/**
	 * Package cleanup after events.
	 */
	public readonly eventPackageCleanupAfter = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<IPackageCleanupAfter>(this)
	);

	/**
	 * Package list error events.
	 */
	public readonly eventPackageListError = (
		// eslint-disable-next-line no-invalid-this
		new Dispatcher<Error>(this)
	);

	/**
	 * Packages URL.
	 */
	@property(false)
	protected readonly _packagesUrl: string = PACKAGES_URL;

	/**
	 * Packages file.
	 */
	@property(false)
	protected readonly _packagesFile: string = PACKAGES_FILE;

	/**
	 * Package file.
	 */
	@property(false)
	protected readonly _packageFile: string = PACKAGE_FILE;

	/**
	 * Main directory.
	 */
	@property(false)
	protected readonly _mainDir: string = MAIN_DIR;

	/**
	 * Meta directory.
	 */
	@property(false)
	protected readonly _metaDir: string = META_DIR;

	/**
	 * Temp directory.
	 */
	@property(false)
	protected readonly _tempDir: string = TEMP_DIR;

	/**
	 * Path environment variable name.
	 */
	@property(false)
	protected readonly _pathEnv: string = PATH_ENV;

	/**
	 * Packages URL environment variable name.
	 */
	@property(false)
	protected readonly _packagesUrlEnv: string = PACKAGES_URL_ENV;

	/**
	 * Inited flag.
	 */
	@property(false)
	protected _inited = false;

	/**
	 * Destroyed flag.
	 */
	@property(false)
	protected _destroyed = false;

	/**
	 * Exclusive access flag.
	 */
	@property(false)
	protected _exclusive = false;

	/**
	 * Root path.
	 */
	@property(false)
	protected readonly _path: string;

	/**
	 * Lock file instance.
	 */
	@property(false)
	protected readonly _lock: Lock;

	/**
	 * Packages instance.
	 */
	@property(false)
	protected readonly _packages: Packages;

	/**
	 * Request instance.
	 */
	@property(false)
	protected readonly _request: Request;

	constructor(path: string | null = null) {
		super();

		this._path = this._createPath(path);
		const lock = this._createLock();
		lock.eventCompromised.on(() => {
			// Do nothing, instead fail on next assert call.
		});
		this._lock = lock;
		this._packagesUrl = this._createPackagesUrl(this._packagesUrl);
		this._packages = this._createPackages();
		this._request = this._createRequest();
	}

	/**
	 * Root path.
	 *
	 * @returns The path.
	 */
	public get path() {
		return this._path;
	}

	/**
	 * Packages URL.
	 *
	 * @returns The URL.
	 */
	public get packagesUrl() {
		return this._packagesUrl;
	}

	/**
	 * Packages file.
	 *
	 * @returns The file.
	 */
	public get packagesFile() {
		return this._packagesFile;
	}

	/**
	 * Package file.
	 *
	 * @returns The path.
	 */
	public get packageFile() {
		return this._packageFile;
	}

	/**
	 * Packages file path.
	 *
	 * @returns The path.
	 */
	public get pathMetaPackages() {
		return this.pathToMeta(this.packagesFile);
	}

	/**
	 * Meta directory.
	 *
	 * @returns The directory.
	 */
	public get metaDir() {
		return this._metaDir;
	}

	/**
	 * Temp directory.
	 *
	 * @returns The directory.
	 */
	public get tempDir() {
		return this._tempDir;
	}

	/**
	 * Meta directory path for root path.
	 *
	 * @returns The path.
	 */
	public get pathMeta() {
		return this.pathToMeta();
	}

	/**
	 * Instance inited and not yet destroyed.
	 *
	 * @returns Is active.
	 */
	public get active() {
		return !this._destroyed && this._inited;
	}

	/**
	 * Packages loaded.
	 *
	 * @returns Is loaded.
	 */
	public get loaded() {
		return this._packages.loaded;
	}

	/**
	 * The lock file compromised.
	 *
	 * @returns Is compromised.
	 */
	public get lockCompromised() {
		return this._lock.compromised;
	}

	/**
	 * Assert instance not inited.
	 */
	public assertNotInited() {
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertNotInited();
		});
	}

	/**
	 * Assert instance is active.
	 * Implies inited, not-destroyed, and lock-not-compromised assertions.
	 */
	public assertActive() {
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertActive();
		});
	}

	/**
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	public assertLoaded() {
		// eslint-disable-next-line no-sync
		this._exclusiveSync(() => {
			this._assertLoaded();
		});
	}

	/**
	 * Initialize instance.
	 */
	public async init() {
		await this._exclusiveAsync(async () => this._init());
	}

	/**
	 * Destroy instance.
	 */
	public async destroy() {
		await this._exclusiveAsync(async () => this._destroy());
	}

	/**
	 * Run asyncronous function with automatic init and destroy.
	 *
	 * @param func Async function.
	 * @returns Return value of the async function.
	 */
	public async with<T>(func: (self: this) => Promise<T>): Promise<T> {
		await this.init();
		let r: T;
		try {
			r = await func.call(this, this);
		}
		finally {
			await this.destroy();
		}
		return r;
	}

	/**
	 * Itterate over the packages.
	 *
	 * @returns Package itterator.
	 */
	public packageItter() {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageItter());
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	public packageByName(name: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByName(name));
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	public packageBySha256(sha256: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageBySha256(sha256));
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	public packageBySha1(sha1: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageBySha1(sha1));
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	public packageByMd5(md5: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByMd5(md5));
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	public packageByUnique(unique: string) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageByUnique(unique));
	}

	/**
	 * Check if package is in packages collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	public packageIsMember(pkg: Package) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packageIsMember(pkg));
	}

	/**
	 * Read package install receipt.
	 *
	 * @param pkg The package.
	 * @returns Install receipt.
	 */
	public async packageInstallReceipt(pkg: PackageLike) {
		return this._exclusiveAsync(
			async () => this._packageMetaReceiptRead(pkg)
		);
	}

	/**
	 * Get package install file.
	 *
	 * @param pkg The package.
	 * @returns Path to install file.
	 */
	public async packageInstallFile(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._packageInstallFile(pkg));
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	public async packageInstallVerify(pkg: PackageLike) {
		await this._exclusiveAsync(async () => this._packageInstallVerify(pkg));
	}

	/**
	 * Packages ordered by dependencies.
	 *
	 * @param pkgs Packages list.
	 * @returns Packages list, sorted order.
	 */
	public packagesDependOrdered(pkgs: PackageLike[]) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._packagesDependOrdered(pkgs));
	}

	/**
	 * Update the package manager installed data.
	 * Updates the packages list.
	 *
	 * @returns Update report.
	 */
	public async update() {
		return this._exclusiveAsync(async () => this._update());
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	public async isInstalled(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._isInstalled(pkg));
	}

	/**
	 * Check if a package is installed and up-to-date.
	 *
	 * @param pkg The package.
	 * @returns True if already up-to-date, else false.
	 */
	public async isCurrent(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._isCurrent(pkg));
	}

	/**
	 * List all installed packages.
	 *
	 * @returns A list of installed package objects.
	 */
	public async installed() {
		return this._exclusiveAsync(async () => this._installed());
	}

	/**
	 * List all outdated packages.
	 *
	 * @returns The list of outdated package objects.
	 */
	public async outdated() {
		return this._exclusiveAsync(async () => this._outdated());
	}

	/**
	 * An alias for upgradeSlim.
	 *
	 * @returns List of packages upgraded.
	 */
	public async upgrade() {
		return this._exclusiveAsync(async () => this._upgrade());
	}

	/**
	 * Upgrade any outdated packages.
	 *
	 * @returns List of packages upgraded.
	 */
	public async upgradeFull() {
		return this._exclusiveAsync(async () => this._upgradeFull());
	}

	/**
	 * Upgrade any outdated packages, using slim install method.
	 *
	 * @returns List of packages upgraded.
	 */
	public async upgradeSlim() {
		return this._exclusiveAsync(async () => this._upgradeSlim());
	}

	/**
	 * An alias for installSlim.
	 *
	 * @param pkg The package.
	 * @returns True if was installed, false if already installed.
	 */
	public async install(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._install(pkg));
	}

	/**
	 * Install package, with parents.
	 * Returns the list of packages installed to install.
	 * Returns empty array if current version is already installed.
	 *
	 * @param pkg The package.
	 * @returns List of packages processed.
	 */
	public async installFull(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._installFull(pkg));
	}

	/**
	 * Install multiple package with parents, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	public async installFullMulti(pkgs: PackageLike[]) {
		return this._exclusiveAsync(async () => this._installFullMulti(pkgs));
	}

	/**
	 * Install package, without parents.
	 * Returns the list of packages downloaded or extracted to install.
	 * Returns empty array if current version is already installed.
	 *
	 * @param pkg The package.
	 * @returns List of packages processed.
	 */
	public async installSlim(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._installSlim(pkg));
	}

	/**
	 * Install multiple package without parents, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	public async installSlimMulti(pkgs: PackageLike[]) {
		return this._exclusiveAsync(async () => this._installSlimMulti(pkgs));
	}

	/**
	 * Remove package.
	 *
	 * @param pkg The package.
	 * @returns True if removed, false if nothing to remove.
	 */
	public async remove(pkg: PackageLike) {
		return this._exclusiveAsync(async () => this._remove(pkg));
	}

	/**
	 * Check if package name is obsolete.
	 *
	 * @param pkg The package.
	 * @returns True if package obslete, else false.
	 */
	public async isObsolete(pkg: string) {
		return this._exclusiveAsync(async () => this._isObsolete(pkg));
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	public async obsolete() {
		return this._exclusiveAsync(async () => this._obsolete());
	}

	/**
	 * Cleanup all obsolete and outdated packages.
	 *
	 * @returns Lists of removed packages.
	 */
	public async cleanup() {
		return this._exclusiveAsync(async () => this._cleanup());
	}

	/**
	 * Join path on the base path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathTo(...parts: string[]) {
		return pathJoin(this.path, ...parts);
	}

	/**
	 * Join path on the meta path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToMeta(...parts: string[]) {
		return this.pathTo(this.metaDir, ...parts);
	}

	/**
	 * Join path on the temp folder path.
	 *
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToTemp(...parts: string[]) {
		return this.pathToMeta(this.tempDir, ...parts);
	}

	/**
	 * Join path on package base path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToPackage(pkg: PackageLike, ...parts: string[]) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(() => this._pathToPackage(pkg, ...parts));
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	public pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		// eslint-disable-next-line no-sync
		return this._exclusiveSync(
			() => this._pathToPackageMeta(pkg, ...parts)
		);
	}

	/**
	 * Join path on package base path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	protected _pathToPackage(pkg: PackageLike, ...parts: string[]) {
		this._assertActive();

		const name = this._packageToName(pkg, false);
		return this.pathTo(name, ...parts);
	}

	/**
	 * Join path on package meta path.
	 *
	 * @param pkg The package.
	 * @param parts Path parts.
	 * @returns Joined path.
	 */
	protected _pathToPackageMeta(pkg: PackageLike, ...parts: string[]) {
		this._assertActive();

		const name = this._packageToName(pkg, false);
		return this.pathTo(name, this.metaDir, ...parts);
	}

	/**
	 * Obtain exclusive access for the duration of a syncronous callback.
	 *
	 * @param func Syncronous function.
	 * @returns Return value of the syncronous callback.
	 */
	protected _exclusiveSync<T>(func: (self: this) => T): T {
		this._assertNotExclusive();

		this._exclusive = true;
		let r: T;
		try {
			r = func.call(this, this);
		}
		finally {
			this._exclusive = false;
		}
		return r;
	}

	/**
	 * Obtain exclusive access for the duration of a asyncronous callback.
	 *
	 * @param func Asyncronous function.
	 * @returns Return value of the asyncronous callback.
	 */
	protected async _exclusiveAsync<T>(
		func: (self: this) => Promise<T>
	): Promise<T> {
		this._assertNotExclusive();

		this._exclusive = true;
		let r: T;
		try {
			r = await func.call(this, this);
		}
		finally {
			this._exclusive = false;
		}
		return r;
	}

	/**
	 * Itterate over the packages.
	 */
	protected * _packageItter() {
		this._assertActive();

		for (const entry of this._packages.itter()) {
			this._assertActive();
			yield entry;
		}
	}

	/**
	 * Get package by the unique name.
	 *
	 * @param name Package name.
	 * @returns The package or null.
	 */
	protected _packageByName(name: string) {
		this._assertLoaded();

		return this._packages.byName(name);
	}

	/**
	 * Get package by the sha256 hash.
	 *
	 * @param sha256 Package sha256.
	 * @returns The package or null.
	 */
	protected _packageBySha256(sha256: string) {
		this._assertLoaded();

		return this._packages.bySha256(sha256);
	}

	/**
	 * Get package by the sha1 hash.
	 *
	 * @param sha1 Package sha1.
	 * @returns The package or null.
	 */
	protected _packageBySha1(sha1: string) {
		this._assertLoaded();

		return this._packages.bySha1(sha1);
	}

	/**
	 * Get package by the md5 hash.
	 *
	 * @param md5 Package md5.
	 * @returns The package or null.
	 */
	protected _packageByMd5(md5: string) {
		this._assertLoaded();

		return this._packages.byMd5(md5);
	}

	/**
	 * Get package by the unique value.
	 *
	 * @param unique Package unique.
	 * @returns The package or null.
	 */
	protected _packageByUnique(unique: string) {
		this._assertLoaded();

		return this._packages.byUnique(unique);
	}

	/**
	 * Check if package is in packages collection.
	 *
	 * @param pkg Package instance.
	 * @returns If the package instance is present.
	 */
	protected _packageIsMember(pkg: Package) {
		this._assertLoaded();

		return this._packages.has(pkg);
	}

	/**
	 * Get package install file.
	 *
	 * @param pkg The package.
	 * @returns Path to install file.
	 */
	protected async _packageInstallFile(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const data = await this._packageMetaReceiptRead(pkg);
		return this._pathToPackage(pkg, data.file);
	}

	/**
	 * Verify package install file, using size and hash.
	 *
	 * @param pkg The package.
	 */
	protected async _packageInstallVerify(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const data = await this._packageMetaReceiptRead(pkg);
		const {sha256, file, size} = data;
		const filePath = this._pathToPackage(pkg, file);

		await fileSizeVerify(filePath, size);

		await fileHashVerify(filePath, [{
			algorithm: 'sha256',
			encoding: 'hex',
			digest: sha256
		}]);
	}

	/**
	 * Get package object by object, name, or hash.
	 * If package object is passed, check that object is known.
	 * Throw error if package is unknown.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected _packageToPackage(pkg: PackageLike) {
		this._assertLoaded();

		let r: Package;
		if (typeof pkg === 'string') {
			const p = this._packageByUnique(pkg);
			if (!p) {
				throw new Error(`Unknown package: ${pkg}`);
			}
			r = p;
		}
		else {
			this._assertpackageIsMember(pkg);
			r = pkg;
		}
		return r;
	}

	/**
	 * Get package name by object, name, or hash.
	 * If package object is passed, check that object is known.
	 * If string is passed and unknown, returns string.
	 *
	 * @param pkg The package.
	 * @param mustExist Must exist.
	 * @returns Package object.
	 */
	protected _packageToName(pkg: PackageLike, mustExist = true) {
		this._assertLoaded();

		let r: string;
		if (typeof pkg === 'string') {
			const pkgObj = this._packageByUnique(pkg);
			if (!pkgObj && mustExist) {
				throw new Error(`Unknown package: ${pkg}`);
			}
			r = pkgObj ? pkgObj.name : pkg;
		}
		else {
			this._assertpackageIsMember(pkg);
			r = pkg.name;
		}
		return r;
	}

	/**
	 * List package parent packages.
	 *
	 * @param pkg The package.
	 * @returns Packages list.
	 */
	protected _packageParents(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const r: Package[] = [];
		for (let p = pkg.parent; p; p = p.parent) {
			r.push(p);
		}
		return r;
	}

	/**
	 * List package parent packages not updated.
	 *
	 * @param pkg The package.
	 * @returns Packages list.
	 */
	protected async _packageParentsNotUpdated(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const r: Package[] = [];
		for (let p = pkg.parent; p; p = p.parent) {
			// eslint-disable-next-line no-await-in-loop
			if (await this._isCurrent(p)) {
				break;
			}
			r.push(p);
		}
		return r;
	}

	/**
	 * List the packages that need to be installed.
	 *
	 * @param pkg The package.
	 * @returns Package root or null and the children list.
	 */
	protected async _packageInstallList(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const r = await this._packageParentsNotUpdated(pkg);
		r.reverse().push(pkg);
		return r;
	}

	/**
	 * Packages ordered by dependencies.
	 *
	 * @param pkgs Packages list.
	 * @returns Packages list, sorted order.
	 */
	protected _packagesDependOrdered(pkgs: PackageLike[]) {
		this._assertLoaded();

		const list = pkgs.map(pkg => this._packageToPackage(pkg));
		return dependSort(list, pkg => this._packageParents(pkg));
	}

	/**
	 * Read package installed receipt.
	 *
	 * @param pkg The package.
	 * @returns Package object.
	 */
	protected async _packageMetaReceiptRead(pkg: PackageLike) {
		this._assertLoaded();

		const name = this._packageToName(pkg, false);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);

		const r: IPackageReceipt | null = await promiseCatch(
			fse.readJson(pkgf),
			null
		);
		if (!r) {
			throw new Error('Package is not installed');
		}
		return r;
	}

	/**
	 * Write package installed receipt.
	 *
	 * @param pkg The package.
	 */
	protected async _packageMetaReceiptWrite(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const name = this._packageToName(pkg);
		const pkgf = this._pathToPackageMeta(name, this.packageFile);

		const receipt = await this._packageMetaReceiptFromPackage(pkg);
		await fse.outputJson(pkgf, receipt, {
			spaces: '\t'
		});
	}

	/**
	 * CReate package installed receipt object from a package.
	 *
	 * @param pkg The package.
	 * @returns Receipt object.
	 */
	protected async _packageMetaReceiptFromPackage(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const r: IPackageReceipt = {
			name: pkg.name,
			file: pkg.file,
			size: pkg.size,
			sha256: pkg.sha256,
			source: pkg.source
		};
		return r;
	}

	/**
	 * Check if package meta directory exists.
	 *
	 * @param pkg The package.
	 * @returns True if the meta directory path, else false.
	 */
	protected async _packageMetaDirExists(pkg: PackageLike) {
		this._assertLoaded();

		const dir = this._pathToPackageMeta(pkg);
		return fse.pathExists(dir);
	}

	/**
	 * Ensure package directory exists.
	 *
	 * @param pkg The package.
	 */
	protected async _packageDirsEnsure(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const dir = this._pathToPackage(pkg);
		const dirMeta = this._pathToPackageMeta(pkg);
		await fse.ensureDir(dir);
		await fse.ensureDir(dirMeta);
	}

	/**
	 * Assert instance not inited.
	 */
	protected _assertNotInited() {
		if (this._inited) {
			throw new Error('Instance initialized');
		}
	}

	/**
	 * Assert instance is inited.
	 */
	protected _assertInited() {
		if (!this._inited) {
			throw new Error('Instance uninitialized');
		}
	}

	/**
	 * Assert instance not destroyed.
	 */
	protected _assertNotDestroyed() {
		if (this._destroyed) {
			throw new Error('Instance destroyed');
		}
	}

	/**
	 * Assert instance lock was not compromised.
	 */
	protected _assertLockNotCompromised() {
		if (this.lockCompromised) {
			throw new Error('Instance lock file compromised');
		}
	}

	/**
	 * Assert instance is active.
	 * Implies inited, not-destroyed, and lock-not-compromised assertions.
	 */
	protected _assertActive() {
		// Check everything is active in order they should report failure.
		this._assertInited();
		this._assertNotDestroyed();
		this._assertLockNotCompromised();
	}

	/**
	 * Assert instance all loaded, including the packages list.
	 * Implies all active assertions.
	 */
	protected _assertLoaded() {
		this._assertActive();
		if (!this.loaded) {
			throw new Error('Packages list not loaded');
		}
	}

	/**
	 * Assert not current running exclusive method.
	 */
	protected _assertNotExclusive() {
		if (this._exclusive) {
			throw new Error('Already running exclusive method');
		}
	}

	/**
	 * Assert the package is in packages collection.
	 *
	 * @param pkg Package instance.
	 */
	protected _assertpackageIsMember(pkg: Package) {
		this._assertLoaded();

		this._packages.assertHas(pkg);
	}

	/**
	 * Assert correct status code.
	 *
	 * @param expected Expected status code.
	 * @param statusCode The actual status code.
	 */
	protected _assertStatusCode(expected: number, statusCode: number) {
		if (statusCode === expected) {
			return;
		}
		throw new Error(
			`Unexpected status code: ${statusCode} expected: ${expected}`
		);
	}

	/**
	 * Assert correct content length.
	 *
	 * @param expected Expected content length, as a number.
	 * @param contentLength The actual content length as string.
	 */
	protected _assertContentLength(expected: number, contentLength: string) {
		const size = +contentLength;
		if (size === expected) {
			return;
		}
		throw new Error(
			`Unexpected content-length: ${contentLength} expected: ${expected}`
		);
	}

	/**
	 * Initialize instance.
	 */
	protected async _init() {
		this._assertNotInited();

		await this._ensureDirs();
		await this._lock.aquire();
		try {
			await this._packages.readIfExists();
		}
		catch (err) {
			// eslint-disable-next-line no-sync
			this.eventPackageListError.triggerSync(err);
		}

		this._inited = true;
		this._destroyed = false;
	}

	/**
	 * Destroy instance.
	 */
	protected async _destroy() {
		// Destroy should always work only once if instance was inited.
		this._assertInited();
		this._assertNotDestroyed();

		// Lock may have been compromised, only release if currently held.
		if (this._lock.held) {
			await this._lock.release();
		}

		this._destroyed = true;
		this._inited = false;
	}

	/**
	 * Update the package manager.
	 * Updates the packages list.
	 *
	 * @returns Update report.
	 */
	protected async _update() {
		this._assertActive();

		return this._updatePackages();
	}

	/**
	 * Check if a package is installed.
	 *
	 * @param pkg The package.
	 * @returns True if already installed, else false.
	 */
	protected async _isInstalled(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		try {
			await this._packageMetaReceiptRead(pkg);
		}
		catch (err) {
			return false;
		}
		return true;
	}

	/**
	 * Check if a package is installed and up-to-date.
	 *
	 * @param pkg The package.
	 * @returns True if already up-to-date, else false.
	 */
	protected async _isCurrent(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		let data: IPackageReceipt | null = null;
		try {
			data = await this._packageMetaReceiptRead(pkg);
		}
		catch (err) {
			return false;
		}
		return !!(
			data.sha256 === pkg.sha256 &&
			data.size === pkg.size &&
			data.file === pkg.file &&
			data.name === pkg.name
		);
	}

	/**
	 * List all installed packages.
	 *
	 * @returns A list of installed package objects.
	 */
	protected async _installed() {
		this._assertLoaded();

		const dirList = await this._packagesDirList();
		const filtered = await arrayFilterAsync(dirList, async entry => {
			const pkg = this._packageByName(entry);
			const installed = pkg && (await this._isInstalled(pkg));
			return installed;
		});
		return this._packagesDependOrdered(filtered);
	}

	/**
	 * List all outdated packages.
	 *
	 * @returns The list of outdated package objects.
	 */
	protected async _outdated() {
		this._assertLoaded();

		const dirList = await this._packagesDirList();
		const filtered = await arrayFilterAsync(dirList, async entry => {
			const pkg = this._packageByName(entry);
			return pkg && !await this._isCurrent(pkg);
		});
		return this._packagesDependOrdered(filtered);
	}

	/**
	 * An alias for upgradeSlim.
	 *
	 * @returns List of packages upgraded.
	 */
	protected async _upgrade() {
		return this._upgradeSlim();
	}

	/**
	 * Upgrade any outdated packages.
	 *
	 * @returns List of packages upgraded.
	 */
	protected async _upgradeFull() {
		this._assertLoaded();

		const outdated = await this._outdated();
		return this._installFullMulti(outdated);
	}

	/**
	 * Upgrade any outdated packages, using slim install method.
	 *
	 * @returns List of packages upgraded.
	 */
	protected async _upgradeSlim() {
		this._assertLoaded();

		const outdated = await this._outdated();
		return this._installSlimMulti(outdated);
	}

	/**
	 * An alias for installSlim.
	 *
	 * @param pkg The package.
	 * @returns True if was installed, false if already installed.
	 */
	protected async _install(pkg: PackageLike) {
		return this._installSlim(pkg);
	}

	/**
	 * Install package, with parents.
	 * Returns the list of packages installed to install.
	 * Returns empty array if current version is already installed.
	 *
	 * @param pkg The package.
	 * @returns List of packages processed.
	 */
	protected async _installFull(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		// If current version is installed, skip.
		const installed = await this._isCurrent(pkg);
		if (installed) {
			// eslint-disable-next-line no-sync
			this.eventPackageInstallCurrent.triggerSync({
				package: pkg,
				method: 'slim'
			});
			return [];
		}

		// List packages to install.
		const list = await this._packageInstallList(pkg);
		const r: Package[] = [];
		for (const p of list) {
			// eslint-disable-next-line no-sync
			this.eventPackageInstallBefore.triggerSync({
				package: pkg,
				method: 'full'
			});

			const {parent} = p;
			const tmpFile = this.pathToTemp(`${p.name}.part`);
			const outFile = this._pathToPackage(p, p.file);
			// eslint-disable-next-line no-await-in-loop
			const inIns = await this._isInstalled(p);
			// eslint-disable-next-line no-await-in-loop
			const oldFile = inIns ? await this._packageInstallFile(p) : null;

			// Download or extract, remove temporary directory on failure.
			// Write the package file last, means successful install.
			try {
				// eslint-disable-next-line no-await-in-loop
				await this._tempDirEnsure(true);
				if (parent) {
					const pF = this._pathToPackage(parent, parent.file);
					// eslint-disable-next-line no-await-in-loop
					await this._packageExtract(p, tmpFile, pF);
				}
				else {
					// eslint-disable-next-line no-await-in-loop
					await this._packageDownload(p, tmpFile);
				}

				// eslint-disable-next-line no-await-in-loop
				await this._packageDirsEnsure(p);
				if (oldFile) {
					// eslint-disable-next-line no-await-in-loop
					await fse.remove(oldFile);
				}
				// eslint-disable-next-line no-await-in-loop
				await fse.move(tmpFile, outFile);
				// eslint-disable-next-line no-await-in-loop
				await this._packageMetaReceiptWrite(p);
			}
			finally {
				// eslint-disable-next-line no-await-in-loop
				await this._tempDirRemove();
			}

			// eslint-disable-next-line no-sync
			this.eventPackageInstallAfter.triggerSync({
				package: pkg,
				method: 'full'
			});

			r.push(p);
		}
		return r;
	}

	/**
	 * Install multiple package with parents, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	protected async _installFullMulti(pkgs: PackageLike[]) {
		this._assertLoaded();

		const list = this._packagesDependOrdered(pkgs);
		return await arrayMapAsync(list, async pkg => ({
			package: pkg,
			installed: await this._installFull(pkg)
		})) as IPackageInstalled[];
	}

	/**
	 * Install package, without parents.
	 * Returns the list of packages downloaded or extracted to install.
	 * Returns empty array if current version is already installed.
	 *
	 * @param pkg The package.
	 * @returns List of packages processed.
	 */
	protected async _installSlim(pkg: PackageLike) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		// If current version is installed, skip.
		const installed = await this._isCurrent(pkg);
		if (installed) {
			// eslint-disable-next-line no-sync
			this.eventPackageInstallCurrent.triggerSync({
				package: pkg,
				method: 'slim'
			});
			return [];
		}

		// List packages to install.
		const list = await this._packageInstallList(pkg);

		// If first root and not only, extract without downloading all.
		let stream = false;
		if (list.length > 1 && !list[0].parent) {
			stream = true;
			list.shift();
		}

		const outFile = this._pathToPackage(pkg, pkg.file);
		const fileTmpBase = this.pathToTemp(pkg.name);
		const fileTmp = (i: number) => `${fileTmpBase}.${i}.part`;
		const oldFile = await this._isInstalled(pkg) ?
			await this._packageInstallFile(pkg) : null;

		// eslint-disable-next-line no-sync
		this.eventPackageInstallBefore.triggerSync({
			package: pkg,
			method: 'slim'
		});

		const r: Package[] = [];
		try {
			await this._tempDirEnsure(true);
			await this._packageDirsEnsure(pkg);

			let i = 0;
			let tmpFileP = '';
			let tmpFile = '';
			for (const p of list) {
				tmpFile = fileTmp(i++);
				const {parent} = p;

				// If streaming from a root package, handle that.
				if (stream) {
					// eslint-disable-next-line no-await-in-loop
					await this._packageStream(p, tmpFile);
					stream = false;
				}
				else {
					// Use previous temp file if present.
					// Else use parent file if not root file.
					// A root package that is not streamed will be downloaded.
					const archive = tmpFileP || (parent ?
						this._pathToPackage(parent, parent.file) :
						null
					);
					if (archive) {
						// eslint-disable-next-line no-await-in-loop
						await this._packageExtract(p, tmpFile, archive);
					}
					else {
						// eslint-disable-next-line no-await-in-loop
						await this._packageDownload(p, tmpFile);
					}
				}

				// Remove previous temporary file if present.
				if (tmpFileP) {
					// eslint-disable-next-line no-await-in-loop
					await fse.remove(tmpFileP);
				}
				tmpFileP = tmpFile;

				r.push(p);
			}

			// Move the final file into place and write package file.
			// Write the package file last, means successful install.
			await this._packageDirsEnsure(pkg);
			if (oldFile) {
				await fse.remove(oldFile);
			}
			await fse.move(tmpFile, outFile);
			await this._packageMetaReceiptWrite(pkg);
		}
		finally {
			await this._tempDirRemove();
		}

		// eslint-disable-next-line no-sync
		this.eventPackageInstallAfter.triggerSync({
			package: pkg,
			method: 'slim'
		});

		return r;
	}

	/**
	 * Install multiple package without parents, higher dependencies first.
	 *
	 * @param pkgs Packages list.
	 * @returns Installed list.
	 */
	protected async _installSlimMulti(pkgs: PackageLike[]) {
		this._assertLoaded();

		const list = this._packagesDependOrdered(pkgs);
		return await arrayMapAsync(list, async pkg => ({
			package: pkg,
			installed: await this._installSlim(pkg)
		})) as IPackageInstalled[];
	}

	/**
	 * Remove package.
	 *
	 * @param pkg The package.
	 * @returns True if removed, false if nothing to remove.
	 */
	protected async _remove(pkg: PackageLike) {
		this._assertLoaded();

		const dir = this._pathToPackage(pkg);
		const stat = await lstatExists(dir);
		if (!stat) {
			return false;
		}
		const dirMeta = this._pathToPackageMeta(pkg);

		// Remove meta directory first, avoid partial installed state.
		await fse.remove(dirMeta);
		await fse.remove(dir);
		return true;
	}

	/**
	 * Check if package name is obsolete.
	 *
	 * @param pkg The package.
	 * @returns True if package obslete, else false.
	 */
	protected async _isObsolete(pkg: string) {
		this._assertLoaded();

		const r = (
			!this._packageByName(pkg) &&
			await this._packageMetaDirExists(pkg)
		);
		return r;
	}

	/**
	 * List obsolete package names.
	 *
	 * @returns A list of obsolete package names.
	 */
	protected async _obsolete() {
		this._assertLoaded();

		const dirList = await this._packagesDirList();
		return arrayFilterAsync(
			dirList,
			async entry => this._isObsolete(entry)
		);
	}

	/**
	 * Cleanup all obsolete and outdated packages.
	 *
	 * @returns Lists of removed packages.
	 */
	protected async _cleanup() {
		this._assertLoaded();

		// Remove the temporary directory if present.
		await this._tempDirRemove();

		// Remove the obsolete packages.
		const obsolete = await this._obsolete();
		return await arrayMapAsync(obsolete, async pkg => {
			// eslint-disable-next-line no-sync
			this.eventPackageCleanupBefore.triggerSync({
				package: pkg
			});

			const removed = await this._remove(pkg);

			// eslint-disable-next-line no-sync
			this.eventPackageCleanupAfter.triggerSync({
				package: pkg,
				removed
			});
			return {
				package: pkg,
				removed
			};
		}) as IPackageRemovedObsolete[];
	}

	/**
	 * List all packages in the directory.
	 * Only those directories with the meta directory are returned.
	 * Dot directories are also always skipped.
	 *
	 * @returns List of all recognized package directories.
	 */
	protected async _packagesDirList() {
		this._assertLoaded();

		const dirList = await readDir(this.path, false);
		return arrayFilterAsync(
			dirList,
			async entry => this._packageMetaDirExists(entry)
		);
	}

	/**
	 * Extract package from archive path.
	 *
	 * @param pkg The package.
	 * @param file Out file.
	 * @param archive Archive file.
	 */
	protected async _packageExtract(
		pkg: PackageLike,
		file: string,
		archive: string
	) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);

		const zip = this._createZip();
		await zip.openFile(archive);
		await this._packageExtractZip(pkg, file, zip);
	}

	/**
	 * Extract package from zip instance.
	 *
	 * @param pkg The package.
	 * @param file Out file.
	 * @param zip Archive file.
	 */
	protected async _packageExtractZip(
		pkg: PackageLike,
		file: string,
		zip: Zip
	) {
		this._assertLoaded();
		const pkgO = pkg = this._packageToPackage(pkg);

		const {source, size, sha256} = pkg;

		// eslint-disable-next-line no-sync
		this.eventPackageExtractBefore.triggerSync({
			package: pkgO
		});

		let found = false;
		await zip.read(async entry => {
			if (entry.path !== source) {
				return false;
			}

			let read = 0;

			// eslint-disable-next-line no-sync
			this.eventPackageExtractProgress.triggerSync({
				package: pkgO,
				total: size,
				amount: 0
			});

			await zipEntryExtract(
				entry,
				file,
				size,
				[{
					algorithm: 'sha256',
					encoding: 'hex',
					digest: sha256
				}],
				data => {
					read += data.length;
					// eslint-disable-next-line no-sync
					this.eventPackageExtractProgress.triggerSync({
						package: pkgO,
						total: size,
						amount: read
					});
				}
			);

			found = true;
			return true;
		});
		if (!found) {
			throw new Error(`Failed to locate for extraction: ${source}`);
		}

		// eslint-disable-next-line no-sync
		this.eventPackageExtractAfter.triggerSync({
			package: pkgO
		});
	}

	/**
	 * Download package.
	 *
	 * @param pkg The package.
	 * @param file Out file.
	 */
	protected async _packageDownload(pkg: PackageLike, file: string) {
		this._assertLoaded();
		const pkgO = pkg = this._packageToPackage(pkg);

		const {size, sha256} = pkg;

		// eslint-disable-next-line no-sync
		this.eventPackageDownloadBefore.triggerSync({
			package: pkgO
		});

		let read = 0;
		await streamRequestDownload(
			this._request.stream({
				url: pkg.source
			}),
			file,
			size,
			[{
				algorithm: 'sha256',
				encoding: 'hex',
				digest: sha256
			}],
			response => {
				const {statusCode, headers} = response;
				const contentLength = headers['content-length'];
				this._assertStatusCode(200, statusCode);
				if (contentLength) {
					this._assertContentLength(size, contentLength);
				}

				// eslint-disable-next-line no-sync
				this.eventPackageDownloadProgress.triggerSync({
					package: pkgO,
					total: size,
					amount: 0
				});
			},
			data => {
				read += data.length;
				// eslint-disable-next-line no-sync
				this.eventPackageDownloadProgress.triggerSync({
					package: pkgO,
					total: size,
					amount: read
				});
			}
		);

		// eslint-disable-next-line no-sync
		this.eventPackageDownloadAfter.triggerSync({
			package: pkgO
		});
	}

	/**
	 * Stream package out of root package.
	 *
	 * @param pkg The package.
	 * @param file Out file.
	 */
	protected async _packageStream(pkg: PackageLike, file: string) {
		this._assertLoaded();
		pkg = this._packageToPackage(pkg);
		const {parent} = pkg;

		if (!parent || parent.parent) {
			throw new Error('Can only stream direct children of root packages');
		}

		// Extract from zip without downloading the full zip.
		const streamer = this._packageStreamStreamer(parent);
		const zip = this._createZip();
		await zip.openStreamer(streamer, parent.size);
		await this._packageExtractZip(pkg, file, zip);
	}

	/**
	 * Create streamer function for a package.
	 * Only works for a root package.
	 *
	 * @param pkg The package.
	 * @returns Streamer function.
	 */
	protected _packageStreamStreamer(pkg: PackageLike) {
		this._assertLoaded();
		const pkgO = pkg = this._packageToPackage(pkg);

		const {source} = pkg;
		return (start: number, end: number) => {
			const size = end - start;

			// eslint-disable-next-line no-sync
			this.eventPackageStreamBefore.triggerSync({
				package: pkgO
			});

			let read = 0;
			const stream = this._request.stream({
				url: source,
				headers: {
					Range: `bytes=${start}-${end - 1}`
				}
			});
			streamRequest(
				stream,
				null,
				null,
				response => {
					const {statusCode, headers} = response;
					const contentLength = headers['content-length'];
					this._assertStatusCode(206, statusCode);
					if (contentLength) {
						this._assertContentLength(size, contentLength);
					}

					// eslint-disable-next-line no-sync
					this.eventPackageStreamProgress.triggerSync({
						package: pkgO,
						total: size,
						amount: 0
					});
				},
				data => {
					read += data.length;
					// eslint-disable-next-line no-sync
					this.eventPackageStreamProgress.triggerSync({
						package: pkgO,
						total: size,
						amount: read
					});
				}
			)
				.then(() => {
					// eslint-disable-next-line no-sync
					this.eventPackageStreamAfter.triggerSync({
						package: pkgO
					});
				})
				.catch(() => {
					// Do nothing, let ZIP library handle stream errors.
				});

			// Workaround for type issue.
			return stream;
		};
	}

	/**
	 * Request the packages file.
	 *
	 * @returns File contents as string.
	 */
	protected async _requestPackages() {
		this._assertActive();

		// Headers and gzip to avoid compression and reduce transfer size.
		const {response, body} = await this._request.promise({
			url: this.packagesUrl,
			headers: {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				'Cache-Control': 'max-age=0',
				Pragma: 'no-cache'
			},
			gzip: true
		});
		const {statusCode} = response;
		this._assertStatusCode(200, statusCode);
		if (typeof body !== 'string') {
			throw new Error(`Unexpected response body type: ${typeof body}`);
		}
		return body;
	}

	/**
	 * Update the packages list.
	 *
	 * @returns Update report.
	 */
	protected async _updatePackages() {
		this._assertActive();

		// Read data, update list, write list to file, return report.
		const data = await this._requestPackages();
		const report = this._packages.update(data);
		await this._packages.write();
		return report;
	}

	/**
	 * Ensure base directories exists.
	 */
	protected async _ensureDirs() {
		await fse.ensureDir(this.path);
		await fse.ensureDir(this.pathMeta);
	}

	/**
	 * Ensure temp directory exists.
	 *
	 * @param clean Clean existing.
	 */
	protected async _tempDirEnsure(clean = false) {
		if (clean) {
			await this._tempDirRemove();
		}
		await fse.ensureDir(this.pathToTemp());
	}

	/**
	 * Ensure temp directory removed.
	 */
	protected async _tempDirRemove() {
		await fse.remove(this.pathToTemp());
	}

	/**
	 * Create the main path.
	 *
	 * @param path The path, defaults to environment variable or relative.
	 * @returns Main path.
	 */
	protected _createPath(path: string | null) {
		// Use specified, or environment variable, or relative default.
		// eslint-disable-next-line no-process-env
		return path || process.env[this._pathEnv] || this._mainDir;
	}

	/**
	 * Create the packages URL.
	 *
	 * @param defaultUrl The default URL if the environment variable not set.
	 * @returns Packages URL.
	 */
	protected _createPackagesUrl(defaultUrl: string) {
		// eslint-disable-next-line no-process-env
		return process.env[this._packagesUrlEnv] || defaultUrl;
	}

	/**
	 * Create the Lock instance.
	 *
	 * @returns Lock instance.
	 */
	protected _createLock() {
		return new Lock(this.pathMeta);
	}

	/**
	 * Create the Packages instance.
	 *
	 * @returns Packages instance.
	 */
	protected _createPackages() {
		return new Packages(this.pathMetaPackages);
	}

	/**
	 * Create the Request instance.
	 *
	 * @returns Request instance.
	 */
	protected _createRequest() {
		return new Request();
	}

	/**
	 * Create a Zip instance.
	 *
	 * @returns Zip instance.
	 */
	protected _createZip() {
		return new Zip();
	}
}
