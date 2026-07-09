// Structured-output schemas for TinyFish agent runs

export const infraOutputSchema = {
  type: "object",
  properties: {
    techStack: {
      type: "object",
      properties: {
        framework: { type: "string", nullable: true },
        cdn: { type: "string", nullable: true },
      },
    },
    traffic: {
      type: "object",
      properties: {
        confidence: { type: "string", enum: ["high", "medium", "low"], nullable: true },
        notes: { type: "array", items: { type: "string" } },
      },
    },
  },
};

export const buildOutputSchema = {
  type: "object",
  properties: {
    detected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          complexity: { type: "string", enum: ["extreme", "hard", "medium"], nullable: true },
          evidence: { type: "string", nullable: true },
        },
        required: ["name"],
      },
    },
    pricingPageFeatures: { type: "array", items: { type: "string" } },
  },
};

export const buyerOutputSchema = {
  type: "object",
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "string", nullable: true },
          features: { type: "array", items: { type: "string" } },
          limits: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
    finePrint: { type: "array", items: { type: "string" } },
  },
};

export const riskOutputSchema = {
  type: "object",
  properties: {
    securityHeaders: {
      type: "object",
      properties: {
        https: { type: "boolean", nullable: true },
        hsts: { type: "boolean", nullable: true },
        csp: { type: "boolean", nullable: true },
        xFrameOptions: { type: "string", nullable: true },
        xContentTypeOptions: { type: "boolean", nullable: true },
      },
    },
    privacyCompliance: {
      type: "object",
      properties: {
        privacyPolicyUrl: { type: "string", nullable: true },
        termsUrl: { type: "string", nullable: true },
        complianceBadges: { type: "array", items: { type: "string" } },
        cookieConsent: { type: "boolean", nullable: true },
      },
    },
    trackers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tracker: { type: "string" },
          category: {
            type: "string",
            enum: ["analytics", "advertising", "social", "functional", "other"],
            nullable: true,
          },
          dataShared: { type: "string", nullable: true },
        },
        required: ["tracker"],
      },
    },
  },
};

export const competitorsOutputSchema = {
  type: "object",
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string", nullable: true },
          description: { type: "string", nullable: true },
          startingPrice: { type: "string", nullable: true },
          keyDifferentiator: { type: "string", nullable: true },
        },
        required: ["name"],
      },
    },
  },
  required: ["competitors"],
};

export const pricingOutputSchema = buyerOutputSchema;

export const featuresOutputSchema = buildOutputSchema;
