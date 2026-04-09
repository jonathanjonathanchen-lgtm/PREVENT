import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL  = "https://sxgmpqmnimvfwrfzvzst.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6VZcThL-U2X5Je73Xla3NQ_KAhKlOGi";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
