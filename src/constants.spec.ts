/* eslint-env jasmine */

import {
	parse as urlParse
} from 'url';

import {
	PACKAGES_URL
} from './constants';

describe('constants', () => {
	describe('PACKAGES_URL', () => {
		it('Check URL', () => {
			const parsed = urlParse(PACKAGES_URL);

			expect(parsed.protocol).toBe('https:');
			expect(parsed.auth).toBeNull();
			expect(parsed.hash).toBeNull();
		});
	});
});
