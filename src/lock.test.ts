import {describe, it, beforeEach, afterEach} from 'node:test';
import {ok, strictEqual} from 'node:assert';
import {mkdir, rm} from 'node:fs/promises';

import {Lock} from './lock';

const tmpPath = './spec/tmp/lock';
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
async function getPromiseError(p: Promise<unknown>) {
	try {
		await p;
	} catch (err) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return err;
	}
	// eslint-disable-next-line no-undefined
	return undefined;
}

void describe('lock', () => {
	void describe('Lock', () => {
		void beforeEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
			await mkdir(tmpPathDir, {recursive: true});
		});

		void afterEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void it('normal', async () => {
			const lock = new Lock(tmpPathDir);

			strictEqual(lock.held, false);
			strictEqual(await lock.check(), false);

			await lock.aquire();

			strictEqual(lock.held, true);
			strictEqual(await lock.check(), true);

			await lock.release();

			strictEqual(lock.held, false);
			strictEqual(await lock.check(), false);
		});

		void it('other held', async () => {
			const lockA = new Lock(tmpPathDir);
			const lockB = new Lock(tmpPathDir);

			strictEqual(lockA.held, false);
			strictEqual(lockB.held, false);
			strictEqual(await lockA.check(), false);
			strictEqual(await lockB.check(), false);

			await lockA.aquire();

			strictEqual(lockA.held, true);
			strictEqual(lockB.held, false);
			strictEqual(await lockA.check(), true);
			strictEqual(await lockB.check(), true);

			ok(await getPromiseError(lockB.aquire()));

			await lockA.release();

			strictEqual(lockA.held, false);
			strictEqual(lockB.held, false);
			strictEqual(await lockA.check(), false);
			strictEqual(await lockB.check(), false);

			await lockB.aquire();

			strictEqual(lockA.held, false);
			strictEqual(lockB.held, true);
			strictEqual(await lockA.check(), true);
			strictEqual(await lockB.check(), true);

			ok(await getPromiseError(lockA.aquire()));

			await lockB.release();
		});

		void it('compromised', async () => {
			const lock = new Lock(tmpPathDir);
			lock.stale = 4000;
			lock.update = 2000;
			let error: Error | null = null;
			lock.eventCompromised.on(err => {
				error = err;
			});

			await lock.aquire();

			await rm(`${tmpPathDir}.lock`, {recursive: true, force: true});

			// Wait until lock fails or timeout.
			const timeout = Date.now() + lock.stale;
			// eslint-disable-next-line no-unmodified-loop-condition
			while (!error && Date.now() < timeout) {
				// eslint-disable-next-line no-await-in-loop
				await sleep(0);
			}

			ok(error);
		});
	});
});
