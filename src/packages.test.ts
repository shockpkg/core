/* eslint-disable max-nested-callbacks */

import {describe, it, beforeEach, afterEach} from 'node:test';
import {deepStrictEqual, ok, strictEqual, throws} from 'node:assert';
import {access, mkdir, rm, writeFile} from 'node:fs/promises';

import {Packages} from './packages';

/**
 * String repeat.
 *
 * @param s The string to repeat.
 * @param n Number of repeat times.
 * @returns Repeated string.
 */
function stringRepeat(s: string, n: number) {
	return new Array(n + 1).join(s);
}

/**
 * Create dummy sha256 hash.
 *
 * @param prefix Hash prefix.
 * @returns Dummy hash.
 */
function dummySha256(prefix: string) {
	return prefix + stringRepeat('0', 64 - prefix.length);
}

/**
 * Create dummy sha1 hash.
 *
 * @param prefix Hash prefix.
 * @returns Dummy hash.
 */
function dummySha1(prefix: string) {
	return prefix + stringRepeat('0', 40 - prefix.length);
}

/**
 * Create dummy md5 hash.
 *
 * @param prefix Hash prefix.
 * @returns Dummy hash.
 */
function dummyMd5(prefix: string) {
	return prefix + stringRepeat('0', 32 - prefix.length);
}

const tmpPath = './spec/tmp/packages';

const tmpPathPackages = `${tmpPath}/packages.json`;

const dummyPackages = {
	format: '1.2',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			sha1: dummySha1('A'),
			md5: dummyMd5('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-b',
			file: 'package-b.zip',
			sha256: dummySha256('B'),
			sha1: dummySha1('B'),
			md5: dummyMd5('B'),
			size: 1000,
			source: 'https://example.com/package-b.zip',
			packages: [
				{
					name: 'package-b-a',
					file: 'package-b-a.zip',
					sha256: dummySha256('BA'),
					sha1: dummySha1('BA'),
					md5: dummyMd5('BA'),
					size: 100,
					source: 'package-b-a.zip',
					zipped: '0-200-800',
					packages: [
						{
							name: 'package-b-a-a',
							file: 'package-b-a-a.zip',
							sha256: dummySha256('BAA'),
							sha1: dummySha1('BAA'),
							md5: dummyMd5('BAA'),
							size: 10,
							source: 'package-b-a-a.zip',
							zipped: '0-100-200'
						},
						{
							name: 'package-b-a-b',
							file: 'package-b-a-b.zip',
							sha256: dummySha256('BAB'),
							sha1: dummySha1('BAB'),
							md5: dummyMd5('BAB'),
							size: 10,
							source: 'package-b-a-b.zip',
							zipped: '0-500-200'
						}
					]
				},
				{
					name: 'package-b-b',
					file: 'package-b-b.zip',
					sha256: dummySha256('BB'),
					sha1: dummySha1('BB'),
					md5: dummyMd5('BB'),
					size: 100,
					source: 'package-b-b.zip',
					zipped: '0-900-300'
				}
			]
		},
		{
			name: 'package-c',
			file: 'package-c.zip',
			sha256: dummySha256('C'),
			sha1: dummySha1('C'),
			md5: dummyMd5('C'),
			size: 1000,
			source: 'https://example.com/package-c.zip'
		}
	]
};

const dummyPackagesDuplicateName = {
	format: '1.2',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			sha1: dummySha1('A'),
			md5: dummyMd5('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-a',
			file: 'package-b.zip',
			sha256: dummySha256('B'),
			sha1: dummySha1('B'),
			md5: dummyMd5('B'),
			size: 1000,
			source: 'https://example.com/package-b.zip'
		}
	]
};

const dummyPackagesDuplicateHash = {
	format: '1.2',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			sha1: dummySha1('A'),
			md5: dummyMd5('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-b',
			file: 'package-b.zip',
			sha256: dummySha256('A'),
			sha1: dummySha1('A'),
			md5: dummyMd5('A'),
			size: 1000,
			source: 'https://example.com/package-b.zip'
		}
	]
};

const dummyPackagesFormatMajorUnder = {
	format: '0.0',
	packages: []
};

const dummyPackagesFormatMajorOver = {
	format: '2.0',
	packages: []
};

const dummyPackagesFormatMinorUnder = {
	format: '2.-1',
	packages: []
};

const dummyPackagesFormatMinorOver = {
	format: '2.1',
	packages: []
};

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

void describe('packages', () => {
	void describe('Packages', () => {
		void beforeEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
			await mkdir(tmpPath, {recursive: true});
		});

		void afterEach(async () => {
			await rm(tmpPath, {recursive: true, force: true});
		});

		void describe('update', () => {
			void it('valid', () => {
				const packages = new Packages(tmpPathPackages);

				strictEqual(packages.loaded, false);

				packages.update(JSON.stringify(dummyPackages));

				strictEqual(packages.loaded, true);
			});

			void it('duplicate name', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesDuplicateName);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});

			void it('duplicate hash', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesDuplicateHash);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});

			void it('format major under', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMajorUnder);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});

			void it('format major over', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMajorOver);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});

			void it('format minor under', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMinorUnder);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});

			void it('format minor over', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMinorOver);

				throws(() => {
					packages.update(json);
				});

				strictEqual(packages.loaded, false);
			});
		});

		void it('write', async () => {
			const packages = new Packages(tmpPathPackages);

			strictEqual(
				await access(tmpPathPackages).then(
					() => true,
					() => false
				),
				false
			);

			packages.update(JSON.stringify(dummyPackages));
			await packages.write();

			strictEqual(
				await access(tmpPathPackages).then(
					() => true,
					() => false
				),
				true
			);
		});

		void it('read', async () => {
			const packages = new Packages(tmpPathPackages);

			strictEqual(packages.loaded, false);

			ok(await getPromiseError(packages.read()));

			strictEqual(packages.loaded, false);

			await writeFile(
				tmpPathPackages,
				JSON.stringify(dummyPackages, null, '\t')
			);

			await packages.read();

			strictEqual(packages.loaded, true);
		});

		void it('exists', async () => {
			const packages = new Packages(tmpPathPackages);

			strictEqual(await packages.exists(), false);

			await writeFile(
				tmpPathPackages,
				JSON.stringify(dummyPackages, null, '\t')
			);

			strictEqual(await packages.exists(), true);
		});

		void it('readIfExists', async () => {
			const packages = new Packages(tmpPathPackages);

			strictEqual(packages.loaded, false);

			strictEqual(await packages.readIfExists(), false);

			strictEqual(packages.loaded, false);

			await writeFile(
				tmpPathPackages,
				JSON.stringify(dummyPackages, null, '\t')
			);

			strictEqual(await packages.readIfExists(), true);

			strictEqual(packages.loaded, true);
		});

		void describe('itter', () => {
			void it('parent', () => {
				const packages = new Packages(tmpPathPackages);
				packages.update(JSON.stringify(dummyPackages));

				for (const entry of packages.itter()) {
					const root = entry.name.split('-').length === 2;

					if (root) {
						strictEqual(entry.parent, null);
					} else {
						ok(entry.parent);
					}

					const parentNameExpected = entry.name
						.split('-')
						.slice(0, -1)
						.join('-');
					if (entry.parent) {
						strictEqual(entry.parent.name, parentNameExpected);
					}
				}
			});

			void it('order', () => {
				const packages = new Packages(tmpPathPackages);
				packages.update(JSON.stringify(dummyPackages));

				const names = [];
				for (const pkg of packages.itter()) {
					names.push(pkg.name);
				}

				deepStrictEqual(names, [
					'package-a',
					'package-b',
					'package-b-a',
					'package-b-a-a',
					'package-b-a-b',
					'package-b-b',
					'package-c'
				]);
			});
		});
	});
});
