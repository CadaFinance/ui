import { Metadata } from 'next';
import HomePage from "@/components/HomePage";

type Props = {
  searchParams: { [key: string]: string | string[] | undefined }
}

export async function generateMetadata(
  { searchParams }: Props,
): Promise<Metadata> {
  const ref = searchParams.ref;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://zugchain.org';

  const baseMetadata: Metadata = {
    metadataBase: new URL(baseUrl),
  };

  if (ref) {
    const title = 'Zug Chain | Incentivized Genesis Phase';
    const description = `Earn Genesis Points on the Zug Chain Core Network. Faucet, Stake, and Validate to define your future allocation. Access granted via @${ref}.`;
    return {
      ...baseMetadata,
      title,
      description,
      openGraph: {
        title,
        description,
        images: [`/api/og?ref=${ref}`],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/api/og?ref=${ref}`],
      },
    }
  }

  return {
    ...baseMetadata,
    title: 'Zug Chain | Incentivized Genesis Phase',
    description: 'Earn Genesis Points on the Zug Chain Core Network. Faucet, Stake, and Validate to define your future allocation.',
  }
}

export default function Page() {
  return <HomePage />;
}
