import fse from 'fs-extra';

import {Lock} from './lock';

const tmpPath = './spec/tmp';
const tmpPathDir = `${tmpPath}/dir`;

/**
 * Sleep a promise for specified duration.
 *
 * @param ms The miliseconds to sleep.
 */
async function sleep(ms: number) {
	await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the error from a promise.
 *
 * @param p Promise object.
 * @returns The error or undefined.
 */
async function getPromiseError(p: Promise<any>) {
	try {
		await p;
	} catch (err) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return err;
	}
	// eslint-disable-next-line no-undefined
	return undefined;
}

describe('lock', () => {
	describe('Lock', () => {
		beforeEach(async () => {
			await fse.remove(tmpPath);
			await fse.ensureDir(tmpPathDir);
		});

		afterEach(async () => {
			await fse.remove(tmpPath);
		});

		it('normal', async () => {
			const lock = new Lock(tmpPathDir);

			expect(lock.held).toBe(false);
			expect(await lock.check()).toBe(false);

			await lock.aquire();

			expect(lock.held).toBe(true);
			expect(await lock.check()).toBe(true);

			await lock.release();

			expect(lock.held).toBe(false);
			expect(await lock.check()).toBe(false);
		});

		it('other held', async () => {
			const lockA = new Lock(tmpPathDir);
			const lockB = new Lock(tmpPathDir);

			expect(lockA.held).toBe(false);
			expect(lockB.held).toBe(false);
			expect(await lockA.check()).toBe(false);
			expect(await lockB.check()).toBe(false);

			await lockA.aquire();

			expect(lockA.held).toBe(true);
			expect(lockB.held).toBe(false);
			expect(await lockA.check()).toBe(true);
			expect(await lockB.check()).toBe(true);

			expect(await getPromiseError(lockB.aquire())).toBeTruthy();

			await lockA.release();

			expect(lockA.held).toBe(false);
			expect(lockB.held).toBe(false);
			expect(await lockA.check()).toBe(false);
			expect(await lockB.check()).toBe(false);

			await lockB.aquire();

			expect(lockA.held).toBe(false);
			expect(lockB.held).toBe(true);
			expect(await lockA.check()).toBe(true);
			expect(await lockB.check()).toBe(true);

			expect(await getPromiseError(lockA.aquire())).toBeTruthy();

			await lockB.release();
		});

		it('compromised', async () => {
			const lock = new Lock(tmpPathDir);
			lock.stale = 4000;
			lock.update = 2000;
			let error: Error | null = null;
			lock.eventCompromised.on(err => {
				error = err;
			});

			await lock.aquire();

			await fse.remove(`${tmpPathDir}.lock`);

			// Wait until lock fails or timeout.
			const timeout = Date.now() + lock.stale;
			// eslint-disable-next-line no-unmodified-loop-condition
			while (!error && Date.now() < timeout) {
				// eslint-disable-next-line no-await-in-loop
				await sleep(0);
			}

			expect(error).toBeTruthy();
		});
	});
});
