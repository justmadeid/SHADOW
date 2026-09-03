export type UserPrincipal = {
  kind: "USER";
  subject: string;
  userId: string;
  issuer: string;
};

export type ServicePrincipal = {
  kind: "SERVICE";
  subject: string;
  serviceId: string;
  clientId: string;
  issuer: string;
};

export type AuthenticatedPrincipal = UserPrincipal | ServicePrincipal;
