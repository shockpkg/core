import fse from 'fs-extra';

import {Packages} from './packages';

/**
 * String repeat.
 *
 * @param s The string to repeat.
 * @param n Number of repeat times.
 * @returns Repeated string.
 */
function stringRepeat(s: string, n: number) {
	return (new Array(n + 1)).join(s);
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

const tmpPath = './spec/tmp';

const tmpPathPackages = `${tmpPath}/packages.json`;

const dummyPackages = {
	format: '1.0',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-b',
			file: 'package-b.zip',
			sha256: dummySha256('B'),
			size: 1000,
			source: 'https://example.com/package-b.zip',
			packages: [
				{
					name: 'package-b-a',
					file: 'package-b-a.zip',
					sha256: dummySha256('BA'),
					size: 100,
					source: 'package-b-a.zip',
					packages: [
						{
							name: 'package-b-a-a',
							file: 'package-b-a-a.zip',
							sha256: dummySha256('BAA'),
							size: 10,
							source: 'package-b-a-a.zip'
						},
						{
							name: 'package-b-a-b',
							file: 'package-b-a-b.zip',
							sha256: dummySha256('BAB'),
							size: 10,
							source: 'package-b-a-b.zip'
						}
					]
				},
				{
					name: 'package-b-b',
					file: 'package-b-b.zip',
					sha256: dummySha256('BB'),
					size: 100,
					source: 'package-b-b.zip'
				}
			]
		},
		{
			name: 'package-c',
			file: 'package-c.zip',
			sha256: dummySha256('C'),
			size: 1000,
			source: 'https://example.com/package-c.zip'
		}
	]
};

const dummyPackagesDuplicateName = {
	format: '1.0',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-a',
			file: 'package-b.zip',
			sha256: dummySha256('B'),
			size: 1000,
			source: 'https://example.com/package-b.zip'
		}
	]
};

const dummyPackagesDuplicateHash = {
	format: '1.0',
	packages: [
		{
			name: 'package-a',
			file: 'package-a.zip',
			sha256: dummySha256('A'),
			size: 1000,
			source: 'https://example.com/package-a.zip'
		},
		{
			name: 'package-b',
			file: 'package-b.zip',
			sha256: dummySha256('A'),
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
async function getPromiseError(p: Promise<any>) {
	try {
		await p;
	}
	catch (err) {
		return err;
	}
	// eslint-disable-next-line no-undefined
	return undefined;
}

describe('packages', () => {
	describe('Packages', () => {
		beforeEach(async () => {
			await fse.remove(tmpPath);
			await fse.ensureDir(tmpPath);
		});

		afterEach(async () => {
			await fse.remove(tmpPath);
		});

		describe('update', () => {
			it('valid', () => {
				const packages = new Packages(tmpPathPackages);

				expect(packages.loaded).toBe(false);

				packages.update(JSON.stringify(dummyPackages));

				expect(packages.loaded).toBe(true);
			});

			it('duplicate name', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesDuplicateName);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});

			it('duplicate hash', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesDuplicateHash);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});

			it('format major under', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMajorUnder);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});

			it('format major over', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMajorOver);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});

			it('format minor under', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMinorUnder);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});

			it('format minor over', () => {
				const packages = new Packages(tmpPathPackages);
				const json = JSON.stringify(dummyPackagesFormatMinorOver);

				expect(() => {
					packages.update(json);
				}).toThrow();

				expect(packages.loaded).toBe(false);
			});
		});

		it('write', async () => {
			const packages = new Packages(tmpPathPackages);

			expect(await fse.pathExists(tmpPathPackages)).toBe(false);

			packages.update(JSON.stringify(dummyPackages));
			await packages.write();

			expect(await fse.pathExists(tmpPathPackages)).toBe(true);
		});

		it('read', async () => {
			const packages = new Packages(tmpPathPackages);

			expect(packages.loaded).toBe(false);

			expect(await getPromiseError(packages.read())).toBeTruthy();

			expect(packages.loaded).toBe(false);

			await fse.writeJson(tmpPathPackages, dummyPackages, {
				spaces: '\t'
			});

			await packages.read();

			expect(packages.loaded).toBe(true);
		});

		it('exists', async () => {
			const packages = new Packages(tmpPathPackages);

			expect(await packages.exists()).toBe(false);

			await fse.writeJson(tmpPathPackages, dummyPackages, {
				spaces: '\t'
			});

			expect(await packages.exists()).toBe(true);
		});

		it('readIfExists', async () => {
			const packages = new Packages(tmpPathPackages);

			expect(packages.loaded).toBe(false);

			expect(await packages.readIfExists()).toBe(false);

			expect(packages.loaded).toBe(false);

			await fse.writeJson(tmpPathPackages, dummyPackages, {
				spaces: '\t'
			});

			expect(await packages.readIfExists()).toBe(true);

			expect(packages.loaded).toBe(true);
		});

		describe('itter', () => {
			it('parent', () => {
				const packages = new Packages(tmpPathPackages);
				packages.update(JSON.stringify(dummyPackages));

				for (const entry of packages.itter()) {
					const root = entry.name.split('-').length === 2;

					if (root) {
						expect(entry.parent).toBeNull();
					}
					else {
						expect(entry.parent).toBeTruthy();
					}

					const parentNameExpected = entry.name
						.split('-')
						.slice(0, -1)
						.join('-');
					if (entry.parent) {
						expect(entry.parent.name).toBe(parentNameExpected);
					}
				}
			});

			it('order', () => {
				const packages = new Packages(tmpPathPackages);
				packages.update(JSON.stringify(dummyPackages));

				const names = [];
				for (const pkg of packages.itter()) {
					names.push(pkg.name);
				}

				expect(names).toEqual([
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
