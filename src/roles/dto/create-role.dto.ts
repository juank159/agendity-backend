import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateRoleDto {
    @ApiProperty({
        example: 'Administrador',
        description: 'Nombre del rol',
        required: true
    })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({
        example: 'https://example.com/admin-icon.png',
        description: 'URL de la imagen o ícono del rol',
        required: false
    })
    @IsNotEmpty()
    @IsString()
    @IsOptional()
    image?: string;

    @ApiProperty({
        example: '/admin/dashboard',
        description: 'Ruta base asociada al rol',
        required: false
    })
    @IsNotEmpty()
    @IsString()
    @IsOptional()
    route?: string;
}