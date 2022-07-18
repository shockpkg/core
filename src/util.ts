/**
 * Like array filter method, but with asyncronous callback.
 *
 * @param list The array to filter.
 * @param filter Filter function.
 * @returns Filtered array.
 */
export async function arrayFilterAsync<T>(
	list: Readonly<T[]>,
	filter: (entry: T) => Promise<any>
) {
	const r: T[] = [];
	for (const entry of list) {
		// eslint-disable-next-line no-await-in-loop
		if (await filter(entry)) {
			r.push(entry);
		}
	}
	return r;
}

/**
 * Like array map method, but with asyncronous callback.
 *
 * @param list The array to map.
 * @param map Map function.
 * @returns Mapped array.
 */
export async function arrayMapAsync<T, U>(
	list: Readonly<T[]>,
	map: (entry: T) => Promise<U>
) {
	const r: U[] = [];
	for (const entry of list) {
		// eslint-disable-next-line no-await-in-loop
		r.push(await map(entry));
	}
	return r;
}

/**
 * Sort entries on dependencies listed for each entry.
 * Sorts the array in-place.
 *
 * @param list The array to sort.
 * @param deps Get the list of dependencies for each entry.
 * @returns Sorted array.
 */
export function dependSort<T>(list: T[], deps: (entry: T) => T[]) {
	const m = new Map<T, Set<T>>();
	for (const entry of list) {
		m.set(entry, new Set(deps(entry)));
	}
	return list.sort((a, b) => {
		const aDeps = m.get(a) as Set<T>;
		if (aDeps.has(b)) {
			return 1;
		}
		const bDeps = m.get(b) as Set<T>;
		if (bDeps.has(a)) {
			return -1;
		}
		return 0;
	});
}
