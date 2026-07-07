import { onUnexpectedError } from '../common/errors.js';
import { getMonacoEnvironment } from './browser.js';

type TrustedTypePolicyOptions = import('trusted-types/lib/index.d.ts').TrustedTypePolicyOptions;

export function createTrustedTypesPolicy<Options extends TrustedTypePolicyOptions>(
	policyName: string,
	policyOptions?: Options,
): undefined | Pick<TrustedTypePolicy, 'name' | Extract<keyof Options, keyof TrustedTypePolicyOptions>> {

	const monacoEnvironment = getMonacoEnvironment();

	if (monacoEnvironment?.createTrustedTypesPolicy) {
		try {
			return monacoEnvironment.createTrustedTypesPolicy(policyName, policyOptions);
		} catch (err) {
			onUnexpectedError(err);
			return undefined;
		}
	}
	try {
		// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
		return (globalThis as any).trustedTypes?.createPolicy(policyName, policyOptions);
	} catch (err) {
		onUnexpectedError(err);
		return undefined;
	}
}
