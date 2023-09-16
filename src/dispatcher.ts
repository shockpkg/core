/**
 * Event dispatcher.
 */
export class Dispatcher<T> {
	/**
	 * Event context.
	 */
	protected readonly _context: unknown;

	/**
	 * Event handlers.
	 */
	protected readonly _handlers = new Set<(event: T) => unknown>();

	/**
	 * Event dispatcher constructor.
	 *
	 * @param context Context object.
	 */
	constructor(context: unknown) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this._context = context;
	}

	/**
	 * Add listener.
	 *
	 * @param handler Event handler.
	 */
	public on(handler: (event: T) => unknown) {
		this._handlers.add(handler);
	}

	/**
	 * Remove listener.
	 *
	 * @param handler Event handler.
	 */
	public off(handler: (event: T) => unknown) {
		this._handlers.delete(handler);
	}

	/**
	 * Trigger, sync.
	 *
	 * @param event Event data.
	 * @returns Handler count.
	 */
	public trigger(event: T) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const self = this._context;
		let i = 0;
		for (const cb of this._handlers) {
			cb.call(self, event);
			i++;
		}
		return i;
	}
}
