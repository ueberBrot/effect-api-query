import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

export const usersApi = HttpApi.make("users-api").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", {
      params: { id: Schema.Int },
      success: Schema.Struct({ id: Schema.Int, name: Schema.String }),
    })
  )
);
