export class ReplanNeededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplanNeededError";
  }
}
