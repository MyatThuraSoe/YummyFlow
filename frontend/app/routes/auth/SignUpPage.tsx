import Auth from "@/components/auth/Auth";
import type { Route } from "../+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign Up" },
    { name: "description", content: "Welcome to the Sign Up page" },
  ];
}

const SignUpPage = () => {
  return <Auth />;
};

export default SignUpPage;
