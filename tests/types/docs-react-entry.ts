// fallow-ignore-file unused-export
import { mountUsersApplication } from "./docs-react-setup.tsx";

const element = document.getElementById("root");
if (element === null) {
  throw new Error("Missing application root element");
}

export const stopUsers = await mountUsersApplication(
  element,
  "http://localhost:3000"
);
