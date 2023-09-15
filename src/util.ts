/**
 * Like array filter method, but with asyncronous callback.
 *
 * @param list The array to filter.
 * @param filter Filter function.
 * @returns Filtered array.
 */
export async function arrayFilterAsync<T>(
	list: Readonly<T[]>,
	filter: (entry: T) => Promise<unknown>
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
