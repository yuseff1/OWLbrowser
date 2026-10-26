import { owl } from '../api';

/** who is signed in to this OWL profile (from onboarding + profiles) */
class ProfileInfo {
  name = $state('You');
  subtitle = $state('Personal profile');
  get initial() { return (this.name.trim()[0] || 'Y').toUpperCase(); }
  async load() {
    const [ob, pr] = await Promise.all([owl.onboarding(), owl.profiles()]) as [any, any];
    const p = pr?.profiles?.find((x: any) => x.id === pr.current);
    this.name = ob?.userName || p?.name || 'You';
    this.subtitle = p?.name && p.name !== this.name ? `${p.name} profile` : 'Personal profile';
  }
}
export const profile = new ProfileInfo();
