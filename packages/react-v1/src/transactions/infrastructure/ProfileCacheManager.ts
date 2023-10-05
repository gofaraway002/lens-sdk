import { FetchPolicy } from '@apollo/client';
import {
  FragmentProfile,
  GetProfileData,
  GetProfileDocument,
  GetProfileVariables,
  getSession,
  Profile,
  SafeApolloClient,
  SessionType,
  Sources,
} from '@lens-protocol/api-bindings';
import { ProfileId } from '@lens-protocol/domain/entities';
import { invariant, never, XOR } from '@lens-protocol/shared-kernel';

import { ProfileHandleResolver } from '../../environments';
import { mediaTransformConfigToQueryVariables, MediaTransformsConfig } from '../../mediaTransforms';
import { IProfileCacheManager } from '../adapters/IProfileCacheManager';

type RequestProfileArgs = XOR<
  {
    handle: string;
  },
  {
    id: ProfileId;
  }
>;

export class ProfileCacheManager implements IProfileCacheManager {
  constructor(
    private readonly client: SafeApolloClient,
    private readonly sources: Sources,
    private readonly mediaTransforms: MediaTransformsConfig,
    private readonly handleResolver: ProfileHandleResolver,
  ) {}

  async fetchProfile(id: ProfileId) {
    return this.request({ id }, 'cache-first');
  }

  async fetchNewProfile(handlePrefix: string) {
    const handle = this.handleResolver(handlePrefix);
    const profile = await this.request(
      { handle: this.handleResolver(handlePrefix) },
      'network-only',
    );

    invariant(profile, `Profile "@${handle}" not found`);

    return profile;
  }

  async refreshProfile(id: ProfileId) {
    const profile = await this.request({ id }, 'network-only');

    return profile ?? never();
  }

  private async request(args: RequestProfileArgs, fetchPolicy: FetchPolicy) {
    const session = getSession();

    const { data } = await this.client.query<GetProfileData, GetProfileVariables>({
      query: GetProfileDocument,
      variables: {
        request: args.id
          ? {
              profileId: args.id,
            }
          : {
              handle: args.handle,
            },
        observerId: session?.type === SessionType.WithProfile ? session.profile.id : null,
        sources: this.sources,
        ...mediaTransformConfigToQueryVariables(this.mediaTransforms),
      },
      fetchPolicy,
    });

    return data.result;
  }

  updateProfile(id: string, updateFn: (current: Profile) => Profile): void {
    const identifier =
      this.client.cache.identify({ __typename: 'Profile', id }) ??
      never('Profile identifier not found');

    const profile = this.client.cache.readFragment<Profile>({
      id: identifier,
      fragmentName: 'Profile',
      fragment: FragmentProfile,
    });

    if (profile) {
      const updated = updateFn(profile);

      this.client.cache.writeFragment<Profile>({
        id: identifier,
        fragmentName: 'Profile',
        fragment: FragmentProfile,
        data: updated,
      });
    }
  }
}