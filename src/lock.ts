import {
	check as properCheck,
	lock as properLock
} from 'proper-lockfile';

import {property} from './decorators';
import {Dispatcher} from './dispatcher';

/**
 * Lock constructor.
 *
 * @param path The path to lock.
 */
export class Lock extends Object {

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
	public readonly eventCompromised = new Dispatcher<Error>(this);

	/**
	 * Lock has been compromised since aquire.
	 */
	@property(false)
	protected _compromised = false;

	/**
	 * The path to lock.
	 */
	@property(false)
	protected _path: string;

	/**
	 * The lock release function.
	 */
	@property(false)
	protected _release: (() => Promise<void>) | null = null;

	constructor(path: string) {
		super();

		this._path = path;
	}

	/**
	 * The path to lock.
	 */
	public get path() {
		return this._path;
	}

	/**
	 * Boolean for if lock is held.
	 * The lock could be compromised and not yet detected however.
	 */
	public get held() {
		return !!this._release;
	}

	/**
	 * Boolean for if the lock hase been compromised since aquire.
	 * The lock could be compromised and not yet detected however.
	 */
	public get compromised() {
		return this._compromised;
	}

	/**
	 * Check if path is already locked by any instance including this one.
	 * Does not verify the lock file belongs to this instance.
	 *
	 * @return True if locked, false if not.
	 */
	public async check() {
		// Will throw if not exist when using realpath, so catch.
		let r: boolean;
		try {
			r = await properCheck(this.path);
		}
		catch (err) {
			if (err.code === 'ENOENT') {
				r = false;
			}
			else {
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
			throw new Error('Lock already aquired');
		}

		this._compromised = false;

		this._release = await properLock(this.path, {
			stale: this.stale,
			update: this.update,
			retries: this.retries,
			realpath: this.realpath,
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
			throw new Error('Lock not aquired');
		}

		await this._release();

		this._release = null;
	}
}
