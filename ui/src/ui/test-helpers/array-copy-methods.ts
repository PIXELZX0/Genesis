type ArrayCopyMethodName = "toReversed" | "toSorted";

export function withoutArrayCopyMethods<T>(run: () => T): T {
  const proto = Array.prototype as Array<unknown> & Record<ArrayCopyMethodName, unknown>;
  const previous = {
    toReversed: proto.toReversed,
    toSorted: proto.toSorted,
  };
  const hadOwn = {
    toReversed: Object.prototype.hasOwnProperty.call(proto, "toReversed"),
    toSorted: Object.prototype.hasOwnProperty.call(proto, "toSorted"),
  };

  Reflect.deleteProperty(proto, "toReversed");
  Reflect.deleteProperty(proto, "toSorted");
  try {
    return run();
  } finally {
    restoreArrayCopyMethod(proto, "toReversed", previous.toReversed, hadOwn.toReversed);
    restoreArrayCopyMethod(proto, "toSorted", previous.toSorted, hadOwn.toSorted);
  }
}

function restoreArrayCopyMethod(
  proto: Array<unknown> & Record<ArrayCopyMethodName, unknown>,
  name: ArrayCopyMethodName,
  value: unknown,
  hadOwn: boolean,
) {
  if (hadOwn) {
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value,
    });
    return;
  }
  Reflect.deleteProperty(proto, name);
}
