import { failure, invariant, success } from '@lens-protocol/shared-kernel';
import { mock } from 'jest-mock-extended';

import { DelegableSigning, PaidTransaction } from '../../transactions';
import { SignedOnChain } from '../../transactions/SignedOnChain';
import {
  InsufficientAllowanceError,
  InsufficientFundsError,
  TokenAvailability,
} from '../../wallets/TokenAvailability';
import { mockTokeAvailability } from '../../wallets/__helpers__/mocks';
import {
  OpenAction,
  OpenActionRequest,
  IOpenActionPresenter,
  LegacyCollectRequest,
  SimpleCollectRequest,
  UnknownActionRequest,
  isPaidCollectRequest,
} from '../OpenAction';
import {
  mockCollectFee,
  mockLegacyCollectRequest,
  mockMintFee,
  mockMultirecipientCollectRequest,
  mockSharedRevenueCollectRequest,
  mockSimpleCollectRequest,
  mockUnknownActionRequest,
} from '../__helpers__/mocks';

function setupOpenAction({
  tokenAvailability = mock<TokenAvailability>(),
}: {
  tokenAvailability?: TokenAvailability;
} = {}) {
  const presenter = mock<IOpenActionPresenter>();
  const paidExecution = mock<PaidTransaction<OpenActionRequest>>();
  const signedExecution = mock<SignedOnChain<OpenActionRequest>>();
  const delegableExecution =
    mock<DelegableSigning<LegacyCollectRequest | SimpleCollectRequest | UnknownActionRequest>>();
  const openAction = new OpenAction(
    tokenAvailability,
    signedExecution,
    delegableExecution,
    paidExecution,
    presenter,
  );

  return {
    delegableExecution,
    openAction,
    presenter,
    signedExecution,
    paidExecution,
  };
}

describe(`Given the ${OpenAction.name} use-case interactor`, () => {
  describe.each([
    {
      description: 'LegacyCollectRequest with collect fee',
      request: mockLegacyCollectRequest({ fee: mockCollectFee() }),
    },
    {
      description: 'SimpleCollectRequest with collect fee',
      request: mockSimpleCollectRequest({ fee: mockCollectFee() }),
    },
    {
      description: 'SharedRevenueCollectRequest with mint fee',
      request: mockSharedRevenueCollectRequest({ fee: mockMintFee() }),
    },
    {
      description: 'SharedRevenueCollectRequest with collect fee',
      request: mockSharedRevenueCollectRequest({ fee: mockCollectFee() }),
    },
    {
      description: 'MultirecipientCollectRequest (implicit collect fee)',
      request: mockMultirecipientCollectRequest(),
    },
    {
      description: 'public SimpleCollectRequest with fee',
      request: mockSimpleCollectRequest({ fee: mockCollectFee(), public: true }),
    },
    {
      description: 'public MultirecipientCollectRequest (implicit collect fee)',
      request: mockMultirecipientCollectRequest({ public: true }),
    },
  ])(`when executed with a request that involves a fee`, ({ request, description }) => {
    invariant(isPaidCollectRequest(request), 'Test misconfiguration.');

    it(`should check the token availability for ${description}`, async () => {
      return Promise.all(
        [
          new InsufficientAllowanceError(request.fee.amount),
          new InsufficientFundsError(request.fee.amount),
        ].map(async (error) => {
          const tokenAvailability = mockTokeAvailability({
            request: {
              amount: request.fee.amount,
              spender: request.fee.spender,
            },
            result: failure(error),
          });

          const { openAction, presenter } = setupOpenAction({
            tokenAvailability,
          });

          await openAction.execute(request);

          expect(presenter.present).toHaveBeenLastCalledWith(failure(error));
        }),
      );
    });
  });

  describe.each([
    {
      type: 'LegacyCollectRequest',
      request: mockLegacyCollectRequest({ fee: mockCollectFee() }),
    },
    {
      type: 'SimpleCollectRequest',
      request: mockSimpleCollectRequest({ fee: mockCollectFee() }),
    },
    {
      type: 'SharedRevenueCollectRequest with mint fee',
      request: mockSharedRevenueCollectRequest(),
    },
    {
      type: 'MultirecipientCollectRequest',
      request: mockMultirecipientCollectRequest(),
    },
  ])(`when executed with a request that involves a fee`, ({ request, type }) => {
    invariant(isPaidCollectRequest(request), 'Test misconfiguration.');

    it(`should support the ${SignedOnChain.name}<${type}> strategy`, async () => {
      const tokenAvailability = mockTokeAvailability({
        request: {
          amount: request.fee.amount,
          spender: request.fee.spender,
        },
        result: success(),
      });

      const { openAction, signedExecution, delegableExecution } = setupOpenAction({
        tokenAvailability,
      });

      await openAction.execute(request);

      expect(signedExecution.execute).toHaveBeenCalledWith(request);
      expect(delegableExecution.execute).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      type: 'SimpleCollectRequest',
      request: mockSimpleCollectRequest({ fee: undefined, public: true }),
      tokenAvailability: mock<TokenAvailability>(),
    },
    {
      type: 'SharedRevenueCollectRequest',
      request: mockSharedRevenueCollectRequest({ public: true }),
      tokenAvailability: mockTokeAvailability({ result: success() }),
    },
    {
      type: 'UnknownActionRequest',
      request: mockUnknownActionRequest({ public: true }),
      tokenAvailability: mock<TokenAvailability>(),
    },
    {
      type: 'MultirecipientCollectRequest',
      request: mockMultirecipientCollectRequest({ public: true }),
      tokenAvailability: mockTokeAvailability({ result: success() }),
    },
  ])(`when executed with a request flagged as "public"`, ({ request, type, tokenAvailability }) => {
    it(`should support the ${PaidTransaction.name}<${type}> strategy`, async () => {
      const { openAction, signedExecution, delegableExecution, paidExecution } = setupOpenAction({
        tokenAvailability,
      });

      await openAction.execute(request);

      expect(paidExecution.execute).toHaveBeenCalledWith(request);
      expect(delegableExecution.execute).not.toHaveBeenCalledWith(request);
      expect(signedExecution.execute).not.toHaveBeenCalled();
    });
  });

  describe.each([
    {
      type: 'LegacyCollectRequest',
      request: mockLegacyCollectRequest({ fee: undefined }),
    },
    {
      type: 'SimpleCollectRequest',
      request: mockSimpleCollectRequest({ fee: undefined }),
    },
    {
      type: 'UnknownActionRequest',
      request: mockUnknownActionRequest(),
    },
  ])(
    `when executed with a request without fee or for which is not possible to determine if requires a fee (e.g. unknown open action)`,
    ({ request, type }) => {
      it(`should support the ${DelegableSigning.name}<${type}> strategy`, async () => {
        const { openAction, signedExecution, delegableExecution, paidExecution } =
          setupOpenAction();

        await openAction.execute(request);

        expect(delegableExecution.execute).toHaveBeenCalledWith(request);
        expect(signedExecution.execute).not.toHaveBeenCalled();
        expect(paidExecution.execute).not.toHaveBeenCalledWith(request);
      });
    },
  );

  describe.each([
    {
      type: 'LegacyCollectRequest',
      request: mockLegacyCollectRequest({ sponsored: false }),
    },
    {
      type: 'SimpleCollectRequest',
      request: mockSimpleCollectRequest({ sponsored: false }),
    },
    {
      type: 'SharedRevenueCollectRequest',
      request: mockSharedRevenueCollectRequest({ sponsored: false }),
    },
    {
      type: 'UnknownActionRequest',
      request: mockUnknownActionRequest({ sponsored: false }),
    },
    {
      type: 'MultirecipientCollectRequest',
      request: mockMultirecipientCollectRequest({ sponsored: false }),
    },
  ])(
    'when executed with a request that has the "sponsored" flag set to false',
    ({ request, type }) => {
      it(`should support the ${PaidTransaction.name}<${type}> strategy`, async () => {
        const { openAction, signedExecution, delegableExecution, paidExecution } = setupOpenAction({
          tokenAvailability: mockTokeAvailability({ result: success() }),
        });

        await openAction.execute(request);

        expect(paidExecution.execute).toHaveBeenCalledWith(request);
        expect(delegableExecution.execute).not.toHaveBeenCalledWith(request);
        expect(signedExecution.execute).not.toHaveBeenCalled();
      });
    },
  );
});
