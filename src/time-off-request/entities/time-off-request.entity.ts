import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum RequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum CancellationReason {
  EMPLOYEE_CANCELLED = 'EMPLOYEE_CANCELLED',
  BALANCE_UPDATED_BY_HCM = 'BALANCE_UPDATED_BY_HCM',
}

@Entity('time_off_requests')
export class TimeOffRequest {
  @ApiProperty({ example: 'a1b2c3d4-...', description: 'Request UUID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'emp-123' })
  @Index()
  @Column()
  employeeId: string;

  @ApiProperty({ example: 'loc-us' })
  @Column()
  locationId: string;

  @ApiProperty({ example: '2026-06-01' })
  @Column('date')
  startDate: string;

  @ApiProperty({ example: '2026-06-05' })
  @Column('date')
  endDate: string;

  @ApiProperty({ example: 3, description: 'Number of leave days' })
  @Column('decimal', { precision: 10, scale: 2 })
  days: number;

  @ApiProperty({ enum: RequestStatus, example: RequestStatus.PENDING })
  @Index()
  @Column({ type: 'varchar', default: RequestStatus.PENDING })
  status: RequestStatus;

  @ApiProperty({ enum: CancellationReason, nullable: true, required: false, example: null })
  @Column({ nullable: true, type: 'varchar' })
  cancellationReason: CancellationReason | null;

  @ApiProperty({ example: '2026-05-12T18:00:00.000Z' })
  @CreateDateColumn()
  submittedAt: Date;

  @ApiProperty({ example: '2026-05-12T18:00:00.000Z' })
  @UpdateDateColumn()
  updatedAt: Date;
}
