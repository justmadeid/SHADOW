import { TargetProfile } from "../../../../../../../products/shadow/target-profile";

export default async function ShadowTargetPage({
  params,
}: {
  params: Promise<{ caseId: string; subjectId: string }>;
}) {
  const { caseId, subjectId } = await params;
  return <TargetProfile caseId={caseId} subjectId={subjectId} />;
}
