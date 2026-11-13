import { listCases, stageThresholds } from "@/lib/cases";
import { getMe } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { PipelineView } from "./PipelineView";

export default async function Pipeline() {
  const me = await getMe();
  const sb = await supabaseServer();
  const [cases, th, views] = await Promise.all([
    listCases(), stageThresholds(), sb.from("saved_views").select("id,name,filters").eq("user_id", me.id).order("created_at"),
  ]);
  return <PipelineView cases={cases} th={th} saved={(views.data ?? []) as never} />;
}
