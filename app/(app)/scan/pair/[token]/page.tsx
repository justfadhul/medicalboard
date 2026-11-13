import { PhoneScanner } from "./PhoneScanner";

export default async function Pair({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PhoneScanner token={token} />;
}
