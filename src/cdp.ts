/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
 * One browser-level connection; pages are driven through flattened sessions.
 */

type Handler = (params: any, sessionId?: string) => void;

export class CdpError extends Error {
	override name = 'CdpError';
}

export class CdpConnection {
	#ws: WebSocket;
	#nextId = 0;
	#pending = new Map<
		number,
		{resolve: (v: any) => void; reject: (e: Error) => void; method: string}
	>();
	#handlers = new Map<string, Set<Handler>>();
	#closed = false;
	#closeListeners = new Set<() => void>();

	private constructor(ws: WebSocket) {
		this.#ws = ws;
		ws.addEventListener('message', (event) =>
			this.#onMessage(String(event.data)),
		);
		ws.addEventListener('close', () => this.#onClose());
		ws.addEventListener('error', () => this.#onClose());
	}

	static connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url);
			const timer = setTimeout(() => {
				ws.close();
				reject(new CdpError(`timed out connecting to ${url}`));
			}, timeoutMs);
			ws.addEventListener(
				'open',
				() => {
					clearTimeout(timer);
					resolve(new CdpConnection(ws));
				},
				{once: true},
			);
			ws.addEventListener(
				'error',
				() => {
					clearTimeout(timer);
					reject(new CdpError(`could not connect to ${url}`));
				},
				{once: true},
			);
		});
	}

	get closed(): boolean {
		return this.#closed;
	}

	send<T = any>(
		method: string,
		params: object = {},
		sessionId?: string,
	): Promise<T> {
		if (this.#closed)
			return Promise.reject(new CdpError(`${method}: connection closed`));
		const id = ++this.#nextId;
		return new Promise<T>((resolve, reject) => {
			this.#pending.set(id, {resolve, reject, method});
			this.#ws.send(
				JSON.stringify(
					sessionId ? {id, method, params, sessionId} : {id, method, params},
				),
			);
		});
	}

	on(method: string, handler: Handler): () => void {
		let set = this.#handlers.get(method);
		if (!set) this.#handlers.set(method, (set = new Set()));
		set.add(handler);
		return () => set.delete(handler);
	}

	onClose(listener: () => void): void {
		if (this.#closed) listener();
		else this.#closeListeners.add(listener);
	}

	close(): void {
		this.#ws.close();
		this.#onClose();
	}

	#onMessage(data: string): void {
		const msg = JSON.parse(data);
		if (typeof msg.id === 'number') {
			const pending = this.#pending.get(msg.id);
			if (!pending) return;
			this.#pending.delete(msg.id);
			if (msg.error)
				pending.reject(new CdpError(`${pending.method}: ${msg.error.message}`));
			else pending.resolve(msg.result);
		} else if (typeof msg.method === 'string') {
			for (const handler of this.#handlers.get(msg.method) ?? [])
				handler(msg.params, msg.sessionId);
		}
	}

	#onClose(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const {reject, method} of this.#pending.values()) {
			reject(new CdpError(`${method}: connection closed`));
		}
		this.#pending.clear();
		for (const listener of this.#closeListeners) listener();
		this.#closeListeners.clear();
	}
}
