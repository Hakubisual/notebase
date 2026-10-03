import type { CreateNoteRequest } from '../../core/context';
import { checkRootFolder, isInsideRoot, joinPath } from '../../core/paths';

export class TransferDestinationError extends Error {
	constructor(reason: string) { super(reason); this.name = 'TransferDestinationError'; }
}

/** Parse a transfer destination before passing the request to the shared safe writer. */
export function transferRequest(root: string, request: CreateNoteRequest): CreateNoteRequest {
	const checked = checkRootFolder(root);
	if (!checked.ok) throw new TransferDestinationError(checked.error);
	if (!isInsideRoot(checked.root, joinPath(checked.root, request.folder))) {
		throw new TransferDestinationError('Transfer destination must stay inside the workspace folder.');
	}
	return request;
}
