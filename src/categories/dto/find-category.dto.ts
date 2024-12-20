import { IsOptional, IsString, IsUUID } from 'class-validator';

export class FindCategoryDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
