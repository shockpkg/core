import {PACKAGES_URL} from './constants';

describe('constants', () => {
	describe('PACKAGES_URL', () => {
		it('Check URL', () => {
			expect(PACKAGES_URL.startsWith('https://')).toBeTrue();
		});
	});
});
