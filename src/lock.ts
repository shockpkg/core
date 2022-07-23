import properLockfile from 'proper-lockfile';

import {Dispatcher} from './dispatcher';

/**
 * Lock file.
 */
export class Lock {
	/**
	 * Duration at which the lock is considered stale in milliseconds.
	 * Minimum value of 2000.
	 */
	public stale = 10000;

	/**
	 * Update interval in milliseconds.
	 */
	public update = 5000;

	/**
	 * The number of retries to attempt to aquire the lock.
	 */
	public retries = 0;

	/**
	 * Resolve symlinks using realpath.
	 */
	public realpath = false;

	/**
	 * Compromised lock events.
	 */
	// eslint-disable-next-line no-invalid-this
	public readonly eventCompromised = new Dispatcher<Error>(this);

	/**
	 * Lock has been compromised since aquire.
	 */
	protected _compromised = false;

	/**
	 * The path to lock.
	 */
	protected _path: string;

	/**
	 * The lock release function.
	 */
	protected _release: (() => Promise<void>) | null = null;

	/**
	 * Lock file constructor.
	 *
	 * @param path The path to lock.
	 */
	constructor(path: string) {
		this._path = path;
	}

	/**
	 * The path to lock.
	 *
	 * @returns The path.
	 */
	public get path() {
		return this._path;
	}

	/**
	 * Boolean for if lock is held.
	 * The lock could be compromised and not yet detected however.
	 *
	 * @returns Is held.
	 */
	public get held() {
		return !!this._release;
	}

	/**
	 * Boolean for if the lock hase been compromised since aquire.
	 * The lock could be compromised and not yet detected however.
	 *
	 * @returns Is compromised.
	 */
	public get compromised() {
		return this._compromised;
	}

	/**
	 * Check if path is already locked by any instance including this one.
	 * Does not verify the lock file belongs to this instance.
	 *
	 * @returns True if locked, false if not.
	 */
	public async check() {
		// Will throw if not exist when using realpath, so catch.
		let r: boolean;
		try {
			r = await properLockfile.check(this.path);
		} catch (err) {
			if (err && (err as {code: string}).code === 'ENOENT') {
				r = false;
			} else {
				throw err;
			}
		}
		if (!r) {
			this._release = null;
		}
		return r;
	}

	/**
	 * Aquire lock or fail.
	 */
	public async aquire() {
		if (this._release) {
			throw new Error(`Lock already aquired on: ${this.path}`);
		}

		this._compromised = false;

		this._release = await properLockfile.lock(this.path, {
			stale: this.stale,
			update: this.update,
			retries: this.retries,
			realpath: this.realpath,

			/**
			 * On lock file compromise.
			 *
			 * @param err Error object.
			 */
			onCompromised: async err => {
				this._compromised = true;
				this._release = null;

				await this.eventCompromised.triggerOrThrowAsync(err);
			}
		});
	}

	/**
	 * Release lock or fail.
	 */
	public async release() {
		if (!this._release) {
			throw new Error(`Lock not aquired on: ${this.path}`);
		}

		await this._release();

		this._release = null;
	}
}
