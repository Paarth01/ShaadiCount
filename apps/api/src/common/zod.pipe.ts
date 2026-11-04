import { PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';
import { ApiError } from './errors';

export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new ApiError(
        422,
        'VALIDATION_ERROR',
        'The request contains invalid fields',
        r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }
    return r.data;
  }
}
/** Shorthand: @Body(zb(schema)) / @Query(zb(schema)). */
export const zb = <S extends ZodTypeAny>(s: S) => new ZodPipe(s);

export const uuidParam = new (class implements PipeTransform<string, string> {
  transform(v: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
      throw new ApiError(404, 'NOT_FOUND', 'Resource not found');
    return v.toLowerCase();
  }
})();
