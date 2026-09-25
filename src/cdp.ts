/**
 * A minimal Chrome DevTools Protocol client. One browser-level connection;
 * pages are driven through flattened sessions.
 *
 * Two transports:
 * - a PIPE pair (`--remote-debugging-pipe`), which is what searchcast uses for
 *   the browser it launches: no port, so nothing else on the machine can reach
 *   the browser, and it works where loopback TCP does not;
 * - a WebSocket URL, for attaching to a browser something else started.
 */

type Handler = (params: any, sessionId?: string) => void;

export class CdpError extends Error {
	override name = 'CdpError';
}

/** A message channel: send one JSON message, receive whole messages. */
interface Transport {
	send(message: string): void;
	close(): void;
	onMessage: (message: string) => void;
	onClose: () => void;
}

function webSocketTransport(ws: WebSocket): Transport {
	const transport: Transport = {
		send: (message) => ws.send(message),
		close: () => ws.close(),
		onMessage: () => {},
		onClose: () => {},
	};
	ws.addEventListener('message', (event) =>
		transport.onMessage(String(event.data)),
	);
	ws.addEventListener('close', () => transport.onClose());
	ws.addEventListener('error', () => transport.onClose());
	return transport;
}

/**
 * Chromium's pipe protocol: the browser reads messages on its fd 3 and writes
 * them on its fd 4, each message terminated by a NUL byte.
 */
function pipeTransport(
	write: NodeJS.WritableStream,
	read: NodeJS.ReadableStream,
): Transport {
	let buffer = '';
	const transport: Transport = {
		send: (message) => {
			write.write(message + '\0');
		},
		close: () => {
			write.end();
		},
		onMessage: () => {},
		onClose: () => {},
	};
	read.setEncoding?.('utf8');
	read.on('data', (chunk: string) => {
		buffer += chunk;
		let end: number;
		while ((end = buffer.indexOf('\0')) !== -1) {
			const message = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			transport.onMessage(message);
		}
	});
	read.on('close', () => transport.onClose());
	read.on('end', () => transport.onClose());
	read.on('error', () => transport.onClose());
	// A write after the browser died raises EPIPE; that is a close, not a crash.
	write.on('error', () => transport.onClose());
	return transport;
}

export class CdpConnection {
	#transport: Transport;
	#nextId = 0;
	#pending = new Map<
		number,
		{resolve: (v: any) => void; reject: (e: Error) => void; method: string}
	>();
	#handlers = new Map<string, Set<Handler>>();
	#closed = false;
	#closeListeners = new Set<() => void>();

	private constructor(transport: Transport) {
		this.#transport = transport;
		transport.onMessage = (message) => this.#onMessage(message);
		transport.onClose = () => this.#onClose();
	}

	/** Talk to a browser started with `--remote-debugging-pipe`. */
	static fromPipe(
		write: NodeJS.WritableStream,
		read: NodeJS.ReadableStream,
	): CdpConnection {
		return new CdpConnection(pipeTransport(write, read));
	}

	/** Attach to a browser listening on a DevTools WebSocket URL. */
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
					resolve(new CdpConnection(webSocketTransport(ws)));
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
			this.#transport.send(
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
		this.#transport.close();
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
