import { redirect } from "next/navigation";

/** Landing: send visitors to the dashboard (middleware routes anonymous users to /login). */
export default function Home() {
  redirect("/dashboard");
}
